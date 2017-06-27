'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fulcrumDesktopPlugin = require('fulcrum-desktop-plugin');

var _snakeCase = require('snake-case');

var _snakeCase2 = _interopRequireDefault(_snakeCase);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

exports.default = class {
  constructor() {
    var _this = this;

    this.runCommand = _asyncToGenerator(function* () {
      yield _this.activate();

      if (fulcrum.args.sql) {
        yield _this.runSQL(fulcrum.args.sql);
        return;
      }

      const account = yield fulcrum.fetchAccount(fulcrum.args.org);

      if (account) {
        const forms = yield account.findActiveForms({});

        for (const form of forms) {
          yield _this.updateForm(form, account);
        }
      } else {
        console.error('Unable to find account', fulcrum.args.org);
      }
    });

    this.run = sql => {
      sql = sql.replace(/\0/g, '');

      return this.db.execute(sql);
    };

    this.onFormSave = (() => {
      var _ref2 = _asyncToGenerator(function* ({ form, account, oldForm, newForm }) {
        yield _this.updateForm(form, account);
      });

      return function (_x) {
        return _ref2.apply(this, arguments);
      };
    })();

    this.onRecordsFinished = (() => {
      var _ref3 = _asyncToGenerator(function* ({ form, account }) {
        yield _this.updateForm(form, account);
      });

      return function (_x2) {
        return _ref3.apply(this, arguments);
      };
    })();

    this.updateRecord = (() => {
      var _ref4 = _asyncToGenerator(function* (record) {
        yield _this.updateForm(record.form, account);
      });

      return function (_x3) {
        return _ref4.apply(this, arguments);
      };
    })();

    this.updateForm = (() => {
      var _ref5 = _asyncToGenerator(function* (form, account) {
        const rawPath = fulcrum.databaseFilePath;

        yield _this.run(`ATTACH DATABASE '${rawPath}' as 'app'`);

        yield _this.updateTable(_this.getFriendlyTableName(form), `account_${account.rowID}_form_${form.rowID}_view_full`, null);

        for (const repeatable of form.elementsOfType('Repeatable')) {
          const tableName = _this.getFriendlyTableName(form, repeatable);

          yield _this.updateTable(tableName, `account_${account.rowID}_form_${form.rowID}_${repeatable.key}_view_full`, repeatable);
        }

        yield _this.run(`DETACH DATABASE 'app'`);

        const drop = fulcrum.args.gpkgDrop != null ? fulcrum.args.gpkgDrop : true;

        if (drop) {
          yield _this.cleanupTables(form, account);
        }
      });

      return function (_x4, _x5) {
        return _ref5.apply(this, arguments);
      };
    })();

    this.updateTable = (() => {
      var _ref6 = _asyncToGenerator(function* (tableName, sourceTableName, repeatable) {
        const tempTableName = sourceTableName + '_tmp';

        const includeUserInfo = fulcrum.args.gpkgUserInfo != null ? fulcrum.args.gpkgUserInfo : true;

        let drop = fulcrum.args.gpkgDrop != null ? fulcrum.args.gpkgDrop : true;

        const dropTemplate = `DROP TABLE IF EXISTS ${_this.db.ident(tempTableName)};`;

        yield _this.run(dropTemplate);

        const createTemplateTable = `CREATE TABLE ${_this.db.ident(tempTableName)} AS SELECT * FROM app.${sourceTableName} WHERE 1=0;`;

        yield _this.run(createTemplateTable);

        const result = yield _this.db.get(`SELECT sql FROM sqlite_master WHERE tbl_name = '${tempTableName}'`);
        const { columns } = yield _this.db.execute(`SELECT * FROM app.${sourceTableName} WHERE 1=0;`);

        yield _this.run(dropTemplate);

        const create = result.sql.replace(tempTableName, _this.db.ident(tableName)).replace('(\n', ' (_id INTEGER PRIMARY KEY AUTOINCREMENT, ');

        const columnNames = columns.map(function (o) {
          return _this.db.ident(o.name);
        });

        let orderBy = 'ORDER BY _record_id';

        if (repeatable != null) {
          orderBy = 'ORDER BY _child_record_id';
        }

        const existingTable = yield _this.db.get(`SELECT sql FROM sqlite_master WHERE tbl_name = '${tableName}'`);

        let sql = [];

        if (drop || !existingTable) {
          let userInfo = '';

          if (includeUserInfo) {
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _created_by_email TEXT;`);
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _updated_by_email TEXT;`);
          }

          sql.push(`DROP TABLE IF EXISTS ${_this.db.ident(tableName)};`);

          sql.push(create + ';');
        }

        if (includeUserInfo) {
          sql.push(`
        INSERT INTO ${_this.db.ident(tableName)} (${columnNames.join(', ')}, _created_by_email, _updated_by_email)
        SELECT ${columnNames.map(function (o) {
            return 't.' + o;
          }).join(', ')}, mc.email AS _created_by_email, mu.email AS _updated_by_email
        FROM app.${sourceTableName} t
        LEFT JOIN memberships mc ON t._created_by_id = mc.user_resource_id
        LEFT JOIN memberships mu ON t._updated_by_id = mu.user_resource_id
        ${orderBy};
      `);
        } else {
          sql.push(`
        INSERT INTO ${_this.db.ident(tableName)} (${columnNames.join(', ')})
        SELECT ${columnNames.map(function (o) {
            return 't.' + o;
          }).join(', ')}
        FROM app.${sourceTableName} t
        ${orderBy};
      `);
        }

        yield _this.run(sql.join('\n'));

        sql = [];

        const includeJoinedNames = fulcrum.args.gpkgJoinedNames != null ? fulcrum.args.gpkgJoinedNames : true;

        if (repeatable == null && includeJoinedNames) {
          if (drop || !existingTable) {
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _assigned_to_email TEXT;`);
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _project_name TEXT;`);
          }

          sql.push(`
        UPDATE ${_this.db.ident(tableName)}
        SET _assigned_to_email = (SELECT email FROM app.memberships m WHERE m.user_resource_id = ${_this.db.ident(tableName)}._assigned_to_id),
        _project_name = (SELECT name FROM app.projects p WHERE p.resource_id = ${_this.db.ident(tableName)}._project_id);
      `);

          yield _this.run(sql.join('\n'));
        }

        if (drop || !existingTable) {
          const tableNameLiteral = _this.db.literal(tableName);

          const geomSQL = `
        DELETE FROM gpkg_geometry_columns WHERE table_name=${tableNameLiteral};

        INSERT INTO gpkg_geometry_columns
        (table_name, column_name, geometry_type_name, srs_id, z, m)
        VALUES (${tableNameLiteral}, '_geom', 'POINT', 4326, 0, 0);

        ALTER TABLE ${_this.db.ident(tableName)} ADD _geom BLOB;

        INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
        SELECT ${tableNameLiteral}, 'features', ${tableNameLiteral}, 4326
        WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = ${tableNameLiteral});
      `;

          yield _this.run(geomSQL);
        }

        yield _this.run(`
      UPDATE ${_this.db.ident(tableName)}
      SET _geom = gpkgMakePoint(_longitude, _latitude, 4326);
    `);
      });

      return function (_x6, _x7, _x8) {
        return _ref6.apply(this, arguments);
      };
    })();
  }

  task(cli) {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      return cli.command({
        command: 'geopackage',
        desc: 'create a geopackage database for an organization',
        builder: {
          org: {
            desc: 'organization name',
            required: true,
            type: 'string'
          },
          gpkgName: {
            desc: 'database name',
            required: false,
            type: 'string'
          },
          gpkgPath: {
            desc: 'database directory',
            required: false,
            type: 'string'
          },
          gpkgDrop: {
            desc: 'drop tables first',
            required: false,
            type: 'boolean',
            default: true
          },
          gpkgUnderscoreNames: {
            desc: 'use underscore names (e.g. "Park Inspections" becomes "park_inspections")',
            required: false,
            type: 'boolean',
            default: false
          },
          gpkgUserInfo: {
            desc: 'include user info',
            required: false,
            type: 'boolean',
            default: true
          },
          gpkgJoinedNames: {
            desc: 'include project name and assignment email on record tables',
            required: false,
            type: 'boolean',
            default: true
          }
        },
        handler: _this2.runCommand
      });
    })();
  }

  activate() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      const defaultDatabaseOptions = {
        wal: true,
        autoVacuum: true,
        synchronous: 'off'
      };

      fulcrum.mkdirp('geopackage');

      const databaseName = fulcrum.args.gpkgName || fulcrum.args.org;
      const databaseDirectory = fulcrum.args.gpkgPath || fulcrum.dir('geopackage');

      const options = {
        file: _path2.default.join(databaseDirectory, databaseName + '.gpkg')
      };

      _this3.db = yield _fulcrumDesktopPlugin.SQLite.open(_extends({}, defaultDatabaseOptions, options));

      yield _this3.enableSpatiaLite(_this3.db);

      // fulcrum.on('form:save', this.onFormSave);
      // fulcrum.on('records:finish', this.onRecordsFinished);
    })();
  }

  deactivate() {
    var _this4 = this;

    return _asyncToGenerator(function* () {
      if (_this4.db) {
        yield _this4.db.close();
      }
    })();
  }

  enableSpatiaLite(db) {
    var _this5 = this;

    return _asyncToGenerator(function* () {
      yield new Promise(function (resolve, reject) {
        let spatialitePath = null;

        // the different platforms and configurations require various different load paths for the shared library
        if (process.env.MOD_SPATIALITE) {
          spatialitePath = process.env.MOD_SPATIALITE;
        } else if (process.env.DEVELOPMENT) {
          let platform = 'linux';

          if (process.platform === 'win32') {
            platform = 'win';
          } else if (process.platform === 'darwin') {
            platform = 'mac';
          }

          spatialitePath = _path2.default.join('.', 'resources', 'spatialite', platform, process.arch, 'mod_spatialite');
        } else if (process.platform === 'darwin') {
          spatialitePath = _path2.default.join(_path2.default.dirname(process.execPath), '..', 'Resources', 'mod_spatialite');
        } else if (process.platform === 'win32') {
          spatialitePath = 'mod_spatialite';
        } else {
          spatialitePath = _path2.default.join(_path2.default.dirname(process.execPath), 'mod_spatialite');
        }

        db.database.loadExtension(spatialitePath, function (err) {
          return err ? reject(err) : resolve();
        });
      });

      const check = yield _this5.db.all('SELECT CheckGeoPackageMetaData() AS result');

      if (check[0].result !== 1) {
        const rows = yield _this5.db.all('SELECT gpkgCreateBaseTables()');
      }

      const mode = yield _this5.db.all('SELECT EnableGpkgMode() AS enabled, GetGpkgMode() AS mode');

      if (mode[0].mode !== 1) {
        throw new Error('Unexpected error verifying the GPKG mode');
      }
    })();
  }

  runSQL(sql) {
    var _this6 = this;

    return _asyncToGenerator(function* () {
      let result = null;

      try {
        result = yield _this6.db.all(sql);
      } catch (ex) {
        result = { error: ex.message };
      }

      console.log(JSON.stringify(result));
    })();
  }

  cleanupTables(form, account) {
    var _this7 = this;

    return _asyncToGenerator(function* () {
      yield _this7.reloadTableList();

      const tableNames = [];

      const forms = yield account.findActiveForms({});

      for (const form of forms) {
        tableNames.push(_this7.getFriendlyTableName(form));

        for (const repeatable of form.elementsOfType('Repeatable')) {
          const tableName = _this7.getFriendlyTableName(form, repeatable);

          tableNames.push(tableName);
        }
      }

      // find any tables that should be dropped because they got renamed
      for (const existingTableName of _this7.tableNames) {
        if (tableNames.indexOf(existingTableName) === -1 && !_this7.isSpecialTable(existingTableName)) {
          yield _this7.run(`DROP TABLE IF EXISTS ${_this7.db.ident(existingTableName)};`);
        }
      }
    })();
  }

  isSpecialTable(tableName) {
    if (tableName.indexOf('gpkg_') === 0 || tableName.indexOf('sqlite_') === 0 || tableName.indexOf('custom_') === 0) {
      return true;
    }

    return false;
  }

  reloadTableList() {
    var _this8 = this;

    return _asyncToGenerator(function* () {
      const rows = yield _this8.db.all("SELECT tbl_name AS name FROM sqlite_master WHERE type = 'table';");

      _this8.tableNames = rows.map(function (o) {
        return o.name;
      });
    })();
  }

  getFriendlyTableName(form, repeatable) {
    const name = repeatable ? `${form.name} - ${repeatable.dataName}` : form.name;

    return fulcrum.args.gpkgUnderscoreNames ? (0, _snakeCase2.default)(name) : name;
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJkcm9wIiwiZ3BrZ0Ryb3AiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImluY2x1ZGVVc2VySW5mbyIsImdwa2dVc2VySW5mbyIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJuYW1lIiwib3JkZXJCeSIsImV4aXN0aW5nVGFibGUiLCJ1c2VySW5mbyIsInB1c2giLCJqb2luIiwiaW5jbHVkZUpvaW5lZE5hbWVzIiwiZ3BrZ0pvaW5lZE5hbWVzIiwidGFibGVOYW1lTGl0ZXJhbCIsImxpdGVyYWwiLCJnZW9tU1FMIiwidGFzayIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwidHlwZSIsImdwa2dOYW1lIiwiZ3BrZ1BhdGgiLCJkZWZhdWx0IiwiZ3BrZ1VuZGVyc2NvcmVOYW1lcyIsImhhbmRsZXIiLCJkZWZhdWx0RGF0YWJhc2VPcHRpb25zIiwid2FsIiwiYXV0b1ZhY3V1bSIsInN5bmNocm9ub3VzIiwibWtkaXJwIiwiZGF0YWJhc2VOYW1lIiwiZGF0YWJhc2VEaXJlY3RvcnkiLCJkaXIiLCJvcHRpb25zIiwiZmlsZSIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwiZGVhY3RpdmF0ZSIsImNsb3NlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJzcGF0aWFsaXRlUGF0aCIsInByb2Nlc3MiLCJlbnYiLCJNT0RfU1BBVElBTElURSIsIkRFVkVMT1BNRU5UIiwicGxhdGZvcm0iLCJhcmNoIiwiZGlybmFtZSIsImV4ZWNQYXRoIiwiZGF0YWJhc2UiLCJsb2FkRXh0ZW5zaW9uIiwiZXJyIiwiY2hlY2siLCJhbGwiLCJyb3dzIiwibW9kZSIsIkVycm9yIiwiZXgiLCJtZXNzYWdlIiwibG9nIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlbG9hZFRhYmxlTGlzdCIsInRhYmxlTmFtZXMiLCJleGlzdGluZ1RhYmxlTmFtZSIsImluZGV4T2YiLCJpc1NwZWNpYWxUYWJsZSIsImRhdGFOYW1lIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7O0FBQ0E7Ozs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBa0RuQkEsVUFsRG1CLHFCQWtETixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVBLFVBQUlDLFFBQVFDLElBQVIsQ0FBYUMsR0FBakIsRUFBc0I7QUFDcEIsY0FBTSxNQUFLQyxNQUFMLENBQVlILFFBQVFDLElBQVIsQ0FBYUMsR0FBekIsQ0FBTjtBQUNBO0FBQ0Q7O0FBRUQsWUFBTUUsVUFBVSxNQUFNSixRQUFRSyxZQUFSLENBQXFCTCxRQUFRQyxJQUFSLENBQWFLLEdBQWxDLENBQXRCOztBQUVBLFVBQUlGLE9BQUosRUFBYTtBQUNYLGNBQU1HLFFBQVEsTUFBTUgsUUFBUUksZUFBUixDQUF3QixFQUF4QixDQUFwQjs7QUFFQSxhQUFLLE1BQU1DLElBQVgsSUFBbUJG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QyxHQUFpREEsSUFBeEQ7QUFDRDtBQWpXa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuaW1wb3J0IHNuYWtlIGZyb20gJ3NuYWtlLWNhc2UnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dOYW1lOiB7XG4gICAgICAgICAgZGVzYzogJ2RhdGFiYXNlIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdkYXRhYmFzZSBkaXJlY3RvcnknLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnRHJvcDoge1xuICAgICAgICAgIGRlc2M6ICdkcm9wIHRhYmxlcyBmaXJzdCcsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dVbmRlcnNjb3JlTmFtZXM6IHtcbiAgICAgICAgICBkZXNjOiAndXNlIHVuZGVyc2NvcmUgbmFtZXMgKGUuZy4gXCJQYXJrIEluc3BlY3Rpb25zXCIgYmVjb21lcyBcInBhcmtfaW5zcGVjdGlvbnNcIiknLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ1VzZXJJbmZvOiB7XG4gICAgICAgICAgZGVzYzogJ2luY2x1ZGUgdXNlciBpbmZvJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ0pvaW5lZE5hbWVzOiB7XG4gICAgICAgICAgZGVzYzogJ2luY2x1ZGUgcHJvamVjdCBuYW1lIGFuZCBhc3NpZ25tZW50IGVtYWlsIG9uIHJlY29yZCB0YWJsZXMnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3Muc3FsKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blNRTChmdWxjcnVtLmFyZ3Muc3FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICBjb25zdCBkZWZhdWx0RGF0YWJhc2VPcHRpb25zID0ge1xuICAgICAgd2FsOiB0cnVlLFxuICAgICAgYXV0b1ZhY3V1bTogdHJ1ZSxcbiAgICAgIHN5bmNocm9ub3VzOiAnb2ZmJ1xuICAgIH07XG5cbiAgICBmdWxjcnVtLm1rZGlycCgnZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gZnVsY3J1bS5hcmdzLmdwa2dOYW1lIHx8IGZ1bGNydW0uYXJncy5vcmc7XG4gICAgY29uc3QgZGF0YWJhc2VEaXJlY3RvcnkgPSBmdWxjcnVtLmFyZ3MuZ3BrZ1BhdGggfHwgZnVsY3J1bS5kaXIoJ2dlb3BhY2thZ2UnKTtcblxuICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICBmaWxlOiBwYXRoLmpvaW4oZGF0YWJhc2VEaXJlY3RvcnksIGRhdGFiYXNlTmFtZSArICcuZ3BrZycpXG4gICAgfTtcblxuICAgIHRoaXMuZGIgPSBhd2FpdCBTUUxpdGUub3Blbih7Li4uZGVmYXVsdERhdGFiYXNlT3B0aW9ucywgLi4ub3B0aW9uc30pO1xuXG4gICAgYXdhaXQgdGhpcy5lbmFibGVTcGF0aWFMaXRlKHRoaXMuZGIpO1xuXG4gICAgLy8gZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICAvLyBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgICBpZiAodGhpcy5kYikge1xuICAgICAgYXdhaXQgdGhpcy5kYi5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIHJ1biA9IChzcWwpID0+IHtcbiAgICBzcWwgPSBzcWwucmVwbGFjZSgvXFwwL2csICcnKTtcblxuICAgIHJldHVybiB0aGlzLmRiLmV4ZWN1dGUoc3FsKTtcbiAgfVxuXG4gIG9uRm9ybVNhdmUgPSBhc3luYyAoe2Zvcm0sIGFjY291bnQsIG9sZEZvcm0sIG5ld0Zvcm19KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgb25SZWNvcmRzRmluaXNoZWQgPSBhc3luYyAoe2Zvcm0sIGFjY291bnR9KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlUmVjb3JkID0gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShyZWNvcmQuZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVGb3JtID0gYXN5bmMgKGZvcm0sIGFjY291bnQpID0+IHtcbiAgICBjb25zdCByYXdQYXRoID0gZnVsY3J1bS5kYXRhYmFzZUZpbGVQYXRoO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYEFUVEFDSCBEQVRBQkFTRSAnJHtyYXdQYXRofScgYXMgJ2FwcCdgKTtcblxuICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtKSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fdmlld19mdWxsYCwgbnVsbCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpO1xuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlTmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fJHtyZXBlYXRhYmxlLmtleX1fdmlld19mdWxsYCwgcmVwZWF0YWJsZSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYERFVEFDSCBEQVRBQkFTRSAnYXBwJ2ApO1xuXG4gICAgY29uc3QgZHJvcCA9IGZ1bGNydW0uYXJncy5ncGtnRHJvcCAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dEcm9wIDogdHJ1ZTtcblxuICAgIGlmIChkcm9wKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCk7XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlVGFibGUgPSBhc3luYyAodGFibGVOYW1lLCBzb3VyY2VUYWJsZU5hbWUsIHJlcGVhdGFibGUpID0+IHtcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gc291cmNlVGFibGVOYW1lICsgJ190bXAnO1xuXG4gICAgY29uc3QgaW5jbHVkZVVzZXJJbmZvID0gZnVsY3J1bS5hcmdzLmdwa2dVc2VySW5mbyAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dVc2VySW5mbyA6IHRydWU7XG5cbiAgICBsZXQgZHJvcCA9IGZ1bGNydW0uYXJncy5ncGtnRHJvcCAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dEcm9wIDogdHJ1ZTtcblxuICAgIGNvbnN0IGRyb3BUZW1wbGF0ZSA9IGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9O2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlVGVtcGxhdGVUYWJsZSA9IGBDUkVBVEUgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfSBBUyBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihjcmVhdGVUZW1wbGF0ZVRhYmxlKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RlbXBUYWJsZU5hbWV9J2ApO1xuICAgIGNvbnN0IHtjb2x1bW5zfSA9IGF3YWl0IHRoaXMuZGIuZXhlY3V0ZShgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgKTtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGUgPSByZXN1bHQuc3FsLnJlcGxhY2UodGVtcFRhYmxlTmFtZSwgdGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgnKFxcbicsICcgKF9pZCBJTlRFR0VSIFBSSU1BUlkgS0VZIEFVVE9JTkNSRU1FTlQsICcpO1xuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBjb2x1bW5zLm1hcChvID0+IHRoaXMuZGIuaWRlbnQoby5uYW1lKSk7XG5cbiAgICBsZXQgb3JkZXJCeSA9ICdPUkRFUiBCWSBfcmVjb3JkX2lkJztcblxuICAgIGlmIChyZXBlYXRhYmxlICE9IG51bGwpIHtcbiAgICAgIG9yZGVyQnkgPSAnT1JERVIgQlkgX2NoaWxkX3JlY29yZF9pZCc7XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdUYWJsZSA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RhYmxlTmFtZX0nYCk7XG5cbiAgICBsZXQgc3FsID0gW107XG5cbiAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgbGV0IHVzZXJJbmZvID0gJyc7XG5cbiAgICAgIGlmIChpbmNsdWRlVXNlckluZm8pIHtcbiAgICAgICAgc3FsLnB1c2goYEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2NyZWF0ZWRfYnlfZW1haWwgVEVYVDtgKTtcbiAgICAgICAgc3FsLnB1c2goYEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX3VwZGF0ZWRfYnlfZW1haWwgVEVYVDtgKTtcbiAgICAgIH1cblxuICAgICAgc3FsLnB1c2goYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtgKTtcblxuICAgICAgc3FsLnB1c2goY3JlYXRlICsgJzsnKTtcbiAgICB9XG5cbiAgICBpZiAoaW5jbHVkZVVzZXJJbmZvKSB7XG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSwgX2NyZWF0ZWRfYnlfZW1haWwsIF91cGRhdGVkX2J5X2VtYWlsKVxuICAgICAgICBTRUxFQ1QgJHtjb2x1bW5OYW1lcy5tYXAobyA9PiAndC4nICsgbykuam9pbignLCAnKX0sIG1jLmVtYWlsIEFTIF9jcmVhdGVkX2J5X2VtYWlsLCBtdS5lbWFpbCBBUyBfdXBkYXRlZF9ieV9lbWFpbFxuICAgICAgICBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gdFxuICAgICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbWMgT04gdC5fY3JlYXRlZF9ieV9pZCA9IG1jLnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG11IE9OIHQuX3VwZGF0ZWRfYnlfaWQgPSBtdS51c2VyX3Jlc291cmNlX2lkXG4gICAgICAgICR7b3JkZXJCeX07XG4gICAgICBgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3FsLnB1c2goYFxuICAgICAgICBJTlNFUlQgSU5UTyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gKCR7Y29sdW1uTmFtZXMuam9pbignLCAnKX0pXG4gICAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfVxuICAgICAgICBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gdFxuICAgICAgICAke29yZGVyQnl9O1xuICAgICAgYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oc3FsLmpvaW4oJ1xcbicpKTtcblxuICAgIHNxbCA9IFtdO1xuXG4gICAgY29uc3QgaW5jbHVkZUpvaW5lZE5hbWVzID0gZnVsY3J1bS5hcmdzLmdwa2dKb2luZWROYW1lcyAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dKb2luZWROYW1lcyA6IHRydWU7XG5cbiAgICBpZiAocmVwZWF0YWJsZSA9PSBudWxsICYmIGluY2x1ZGVKb2luZWROYW1lcykge1xuICAgICAgaWYgKGRyb3AgfHwgIWV4aXN0aW5nVGFibGUpIHtcbiAgICAgICAgc3FsLnB1c2goYEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2Fzc2lnbmVkX3RvX2VtYWlsIFRFWFQ7YCk7XG4gICAgICAgIHNxbC5wdXNoKGBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9wcm9qZWN0X25hbWUgVEVYVDtgKTtcbiAgICAgIH1cblxuXG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgU0VUIF9hc3NpZ25lZF90b19lbWFpbCA9IChTRUxFQ1QgZW1haWwgRlJPTSBhcHAubWVtYmVyc2hpcHMgbSBXSEVSRSBtLnVzZXJfcmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX2Fzc2lnbmVkX3RvX2lkKSxcbiAgICAgICAgX3Byb2plY3RfbmFtZSA9IChTRUxFQ1QgbmFtZSBGUk9NIGFwcC5wcm9qZWN0cyBwIFdIRVJFIHAucmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX3Byb2plY3RfaWQpO1xuICAgICAgYCk7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKHNxbC5qb2luKCdcXG4nKSk7XG4gICAgfVxuXG4gICAgaWYgKGRyb3AgfHwgIWV4aXN0aW5nVGFibGUpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZUxpdGVyYWwgPSB0aGlzLmRiLmxpdGVyYWwodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgZ2VvbVNRTCA9IGBcbiAgICAgICAgREVMRVRFIEZST00gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zIFdIRVJFIHRhYmxlX25hbWU9JHt0YWJsZU5hbWVMaXRlcmFsfTtcblxuICAgICAgICBJTlNFUlQgSU5UTyBncGtnX2dlb21ldHJ5X2NvbHVtbnNcbiAgICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgICAgVkFMVUVTICgke3RhYmxlTmFtZUxpdGVyYWx9LCAnX2dlb20nLCAnUE9JTlQnLCA0MzI2LCAwLCAwKTtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9nZW9tIEJMT0I7XG5cbiAgICAgICAgSU5TRVJUIElOVE8gZ3BrZ19jb250ZW50cyAodGFibGVfbmFtZSwgZGF0YV90eXBlLCBpZGVudGlmaWVyLCBzcnNfaWQpXG4gICAgICAgIFNFTEVDVCAke3RhYmxlTmFtZUxpdGVyYWx9LCAnZmVhdHVyZXMnLCAke3RhYmxlTmFtZUxpdGVyYWx9LCA0MzI2XG4gICAgICAgIFdIRVJFIE5PVCBFWElTVFMgKFNFTEVDVCAxIEZST00gZ3BrZ19jb250ZW50cyBXSEVSRSB0YWJsZV9uYW1lID0gJHt0YWJsZU5hbWVMaXRlcmFsfSk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgXG4gICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBTRVQgX2dlb20gPSBncGtnTWFrZVBvaW50KF9sb25naXR1ZGUsIF9sYXRpdHVkZSwgNDMyNik7XG4gICAgYCk7XG4gIH1cblxuICBhc3luYyBlbmFibGVTcGF0aWFMaXRlKGRiKSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgbGV0IHNwYXRpYWxpdGVQYXRoID0gbnVsbDtcblxuICAgICAgLy8gdGhlIGRpZmZlcmVudCBwbGF0Zm9ybXMgYW5kIGNvbmZpZ3VyYXRpb25zIHJlcXVpcmUgdmFyaW91cyBkaWZmZXJlbnQgbG9hZCBwYXRocyBmb3IgdGhlIHNoYXJlZCBsaWJyYXJ5XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEUpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5lbnYuREVWRUxPUE1FTlQpIHtcbiAgICAgICAgbGV0IHBsYXRmb3JtID0gJ2xpbnV4JztcblxuICAgICAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ3dpbic7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICdtYWMnO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4oJy4nLCAncmVzb3VyY2VzJywgJ3NwYXRpYWxpdGUnLCBwbGF0Zm9ybSwgcHJvY2Vzcy5hcmNoLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4nLCAnUmVzb3VyY2VzJywgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSAnbW9kX3NwYXRpYWxpdGUnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH1cblxuICAgICAgZGIuZGF0YWJhc2UubG9hZEV4dGVuc2lvbihzcGF0aWFsaXRlUGF0aCwgKGVycikgPT4gZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKCkpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY2hlY2sgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIENoZWNrR2VvUGFja2FnZU1ldGFEYXRhKCkgQVMgcmVzdWx0Jyk7XG5cbiAgICBpZiAoY2hlY2tbMF0ucmVzdWx0ICE9PSAxKSB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBncGtnQ3JlYXRlQmFzZVRhYmxlcygpJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgRW5hYmxlR3BrZ01vZGUoKSBBUyBlbmFibGVkLCBHZXRHcGtnTW9kZSgpIEFTIG1vZGUnKTtcblxuICAgIGlmIChtb2RlWzBdLm1vZGUgIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5leHBlY3RlZCBlcnJvciB2ZXJpZnlpbmcgdGhlIEdQS0cgbW9kZScpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJ1blNRTChzcWwpIHtcbiAgICBsZXQgcmVzdWx0ID0gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmFsbChzcWwpO1xuICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICByZXN1bHQgPSB7ZXJyb3I6IGV4Lm1lc3NhZ2V9O1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICB9XG5cbiAgYXN5bmMgY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KSB7XG4gICAgYXdhaXQgdGhpcy5yZWxvYWRUYWJsZUxpc3QoKTtcblxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBbXTtcblxuICAgIGNvbnN0IGZvcm1zID0gYXdhaXQgYWNjb3VudC5maW5kQWN0aXZlRm9ybXMoe30pO1xuXG4gICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICB0YWJsZU5hbWVzLnB1c2godGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtKSk7XG5cbiAgICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKTtcblxuICAgICAgICB0YWJsZU5hbWVzLnB1c2godGFibGVOYW1lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBmaW5kIGFueSB0YWJsZXMgdGhhdCBzaG91bGQgYmUgZHJvcHBlZCBiZWNhdXNlIHRoZXkgZ290IHJlbmFtZWRcbiAgICBmb3IgKGNvbnN0IGV4aXN0aW5nVGFibGVOYW1lIG9mIHRoaXMudGFibGVOYW1lcykge1xuICAgICAgaWYgKHRhYmxlTmFtZXMuaW5kZXhPZihleGlzdGluZ1RhYmxlTmFtZSkgPT09IC0xICYmICF0aGlzLmlzU3BlY2lhbFRhYmxlKGV4aXN0aW5nVGFibGVOYW1lKSkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bihgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KGV4aXN0aW5nVGFibGVOYW1lKX07YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaXNTcGVjaWFsVGFibGUodGFibGVOYW1lKSB7XG4gICAgaWYgKHRhYmxlTmFtZS5pbmRleE9mKCdncGtnXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ3NxbGl0ZV8nKSA9PT0gMCB8fFxuICAgICAgICAgIHRhYmxlTmFtZS5pbmRleE9mKCdjdXN0b21fJykgPT09IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJlbG9hZFRhYmxlTGlzdCgpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoXCJTRUxFQ1QgdGJsX25hbWUgQVMgbmFtZSBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdHlwZSA9ICd0YWJsZSc7XCIpO1xuXG4gICAgdGhpcy50YWJsZU5hbWVzID0gcm93cy5tYXAobyA9PiBvLm5hbWUpO1xuICB9XG5cbiAgZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSkge1xuICAgIGNvbnN0IG5hbWUgPSByZXBlYXRhYmxlID8gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gIDogZm9ybS5uYW1lO1xuXG4gICAgcmV0dXJuIGZ1bGNydW0uYXJncy5ncGtnVW5kZXJzY29yZU5hbWVzID8gc25ha2UobmFtZSkgOiBuYW1lO1xuICB9XG59XG4iXX0=