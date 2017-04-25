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
      file: path.join(app.dir('sqlite'), app.args.org + '.db')
    };

    this.db = await app.api.SQLite.open({...defaultDatabaseOptions, ...options});

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

    await this.updateTable(form.name, `account_${account.rowID}_form_${form.rowID}_view_full`);

    for (const repeatable of form.elementsOfType('Repeatable')) {
      const tableName = `${form.name} - ${repeatable.dataName}`;

      await this.updateTable(tableName, `account_${account.rowID}_form_${form.rowID}_${repeatable.key}_view_full`);
    }

    await this.run(`DETACH DATABASE 'app'`);
  }

  updateTable = async (tableName, sourceTableName) => {
    const drop = `DROP TABLE IF EXISTS ${this.db.ident(tableName)};`;
    const create = `CREATE TABLE ${this.db.ident(tableName)} AS SELECT * FROM app.${sourceTableName};`;

    await this.run(drop);
    await this.run(create);
  }
}
