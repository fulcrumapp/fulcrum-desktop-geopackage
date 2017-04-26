import Plugin from 'fulcrum-sync-plugin';
import {format} from 'util';
import path from 'path';

export default class SQLitePlugin extends Plugin {
  async runTask({app, yargs}) {
    this.args = yargs.usage('Usage: sqlite --org [org]')
      .demandOption([ 'org' ])
      .argv;

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

    await this.run('SELECT InitSpatialMetadata()');

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

    await this.run(dropTemplate);

    let create = result.sql.replace(tempTableName, this.db.ident(tableName));

    if (repeatable == null) {
      create = create.replace('_record_id TEXT', '_record_id TEXT PRIMARY KEY');
    } else {
      create = create.replace('_child_record_id TEXT', '_child_record_id TEXT PRIMARY KEY');
    }

    const sql = `
      DROP TABLE IF EXISTS ${this.db.ident(tableName)};

      ${ create };

      INSERT INTO ${this.db.ident(tableName)} SELECT * FROM app.${sourceTableName};

      DELETE FROM gpkg_geometry_columns WHERE table_name='${tableName}';

      SELECT AddGeometryColumn('${tableName}', '_geom', 'POINT', 4326, 0, 0);

      UPDATE ${this.db.ident(tableName)}
      SET _geom = MakePoint(_longitude, _latitude, 4326)
      WHERE _longitude IS NOT NULL AND _latitude IS NOT NULL;

      INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
      SELECT '${tableName}', 'features', '${tableName}', 4326
      WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = '${tableName}');
    `;

    await this.run(sql);
  }
}
