import Plugin from 'fulcrum-sync-plugin';
import {format} from 'util';
import path from 'path';

export default class SQLitePlugin extends Plugin {
  async runTask({app, yargs}) {
    this.args = yargs.usage('Usage: sqlite --org [org]')
      .demandOption([ 'org' ])
      .argv;

    if (this.args.sql) {
      await this.runSQL(this.args.sql);
      return;
    }

    const account = await app.fetchAccount(this.args.org);

    if (account) {
      const forms = await account.findActiveForms({});

      for (const form of forms) {
        await this.updateForm(form, account);
      }
    } else {
      console.error('Unable to find account', this.args.org);
    }
  }

  async initialize({app}) {
    const defaultDatabaseOptions = {
      wal: true,
      autoVacuum: true,
      synchronous: 'off'
    };

    app.mkdirp('sqlite');

    const options = {
      file: path.join(app.dir('sqlite'), app.args.org + '.gpkg')
    };

    this.db = await app.api.SQLite.open({...defaultDatabaseOptions, ...options});

    await this.enableSpatiaLite(this.db);

    app.on('form:save', this.onFormSave);
    app.on('records:finish', this.onRecordsFinished);
  }

  async dispose() {
    await this.db.close();
  }

  run = (sql) => {
    sql = sql.replace(/\0/g, '');

    return this.db.execute(sql);
  }

  onFormSave = async ({form, account, oldForm, newForm}) => {
    await this.updateForm(form, account);
  }

  onRecordsFinished = async ({form, account}) => {
    await this.updateForm(form, account);
  }

  updateRecord = async (record) => {
    await this.updateForm(record.form, account);
  }

  updateForm = async (form, account) => {
    const rawPath = path.join(this.app.dir('data'), 'fulcrum.db');

    await this.run(`ATTACH DATABASE '${rawPath}' as 'app'`);

    await this.updateTable(form.name, `account_${account.rowID}_form_${form.rowID}_view_full`, null);

    for (const repeatable of form.elementsOfType('Repeatable')) {
      const tableName = `${form.name} - ${repeatable.dataName}`;

      await this.updateTable(tableName, `account_${account.rowID}_form_${form.rowID}_${repeatable.key}_view_full`, repeatable);
    }

    await this.run(`DETACH DATABASE 'app'`);
  }

  updateTable = async (tableName, sourceTableName, repeatable) => {
    const tempTableName = sourceTableName + '_tmp';

    const dropTemplate = `DROP TABLE IF EXISTS ${this.db.ident(tempTableName)};`;

    await this.run(dropTemplate);

    const createTemplateTable = `CREATE TABLE ${this.db.ident(tempTableName)} AS SELECT * FROM app.${sourceTableName} WHERE 1=0;`;

    await this.run(createTemplateTable);

    const result = await this.db.get(`SELECT sql FROM sqlite_master WHERE tbl_name = '${tempTableName}'`);
    const {columns} = await this.db.execute(`SELECT * FROM app.${sourceTableName} WHERE 1=0;`);

    await this.run(dropTemplate);

    const create = result.sql.replace(tempTableName, this.db.ident(tableName))
                             .replace('(', ' (\n_id INTEGER PRIMARY KEY AUTOINCREMENT, ');

    const columnNames = columns.map(o => o.name);

    let orderBy = 'ORDER BY _record_id';

    if (repeatable != null) {
      orderBy = 'ORDER BY _child_record_id';
    }

    const allSQL = `
      DROP TABLE IF EXISTS ${this.db.ident(tableName)};

      ${ create };

      ALTER TABLE ${this.db.ident(tableName)}
      ADD _created_by_email TEXT;

      ALTER TABLE ${this.db.ident(tableName)}
      ADD _updated_by_email TEXT;

      INSERT INTO ${this.db.ident(tableName)} (${columnNames.join(', ')}, _created_by_email, _updated_by_email)
      SELECT ${columnNames.map(o => 't.' + o).join(', ')}, mc.email AS _created_by_email, mu.email AS _updated_by_email
      FROM app.${sourceTableName} t
      LEFT JOIN memberships mc ON t._created_by_id = mc.user_resource_id
      LEFT JOIN memberships mu ON t._updated_by_id = mu.user_resource_id
      ${orderBy};
    `;

    await this.run(allSQL);

    if (repeatable == null) {
      const parentSQL = `
        ALTER TABLE ${this.db.ident(tableName)}
        ADD _assigned_to_email TEXT;

        ALTER TABLE ${this.db.ident(tableName)}
        ADD _project_name TEXT;

        UPDATE ${this.db.ident(tableName)}
        SET _assigned_to_email = (SELECT email FROM app.memberships m WHERE m.user_resource_id = ${this.db.ident(tableName)}._assigned_to_id),
        _project_name = (SELECT name FROM app.projects p WHERE p.resource_id = ${this.db.ident(tableName)}._project_id);
      `;

      await this.run(parentSQL);
    }

    const geomSQL = `
      DELETE FROM gpkg_geometry_columns WHERE table_name='${tableName}';

      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id, z, m)
      VALUES ('${tableName}', '_geom', 'POINT', 4326, 0, 0);

      ALTER TABLE ${this.db.ident(tableName)} ADD _geom BLOB;

      UPDATE ${this.db.ident(tableName)}
      SET _geom = gpkgMakePoint(_longitude, _latitude, 4326);

      INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
      SELECT '${tableName}', 'features', '${tableName}', 4326
      WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = '${tableName}');
    `;

    await this.run(geomSQL);
  }

  async enableSpatiaLite(db) {
    await new Promise((resolve, reject) => {
      db.database.loadSpatiaLite((err) => err ? reject(err) : resolve());
    });

    const check = await this.db.all('SELECT CheckGeoPackageMetaData() AS result');

    if (check[0].result !== 1) {
      const rows = await this.db.all('SELECT gpkgCreateBaseTables()');
    }

    const mode = await this.db.all('SELECT EnableGpkgMode() AS enabled, GetGpkgMode() AS mode');

    if (mode[0].mode !== 1) {
      throw new Error('Unexpected error verifying the GPKG mode');
    }
  }

  async runSQL(sql) {
    let result = null;

    try {
      result = await this.db.all(sql);
    } catch (ex) {
      result = {error: ex.message};
    }

    console.log(JSON.stringify(result));
  }
}
