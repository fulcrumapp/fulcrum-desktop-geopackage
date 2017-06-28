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

      if (fulcrum.args.debug) {
        console.log(sql);
      }

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

        const dropTemplate = `DROP TABLE IF EXISTS main.${_this.db.ident(tempTableName)};`;

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

          sql.push(`DROP TABLE IF EXISTS main.${_this.db.ident(tableName)};`);

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
          yield _this7.run(`DROP TABLE IF EXISTS main.${_this7.db.ident(existingTableName)};`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRlYnVnIiwibG9nIiwiZGIiLCJleGVjdXRlIiwib25Gb3JtU2F2ZSIsIm9sZEZvcm0iLCJuZXdGb3JtIiwib25SZWNvcmRzRmluaXNoZWQiLCJ1cGRhdGVSZWNvcmQiLCJyZWNvcmQiLCJyYXdQYXRoIiwiZGF0YWJhc2VGaWxlUGF0aCIsInVwZGF0ZVRhYmxlIiwiZ2V0RnJpZW5kbHlUYWJsZU5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImtleSIsImRyb3AiLCJncGtnRHJvcCIsImNsZWFudXBUYWJsZXMiLCJzb3VyY2VUYWJsZU5hbWUiLCJ0ZW1wVGFibGVOYW1lIiwiaW5jbHVkZVVzZXJJbmZvIiwiZ3BrZ1VzZXJJbmZvIiwiZHJvcFRlbXBsYXRlIiwiaWRlbnQiLCJjcmVhdGVUZW1wbGF0ZVRhYmxlIiwicmVzdWx0IiwiZ2V0IiwiY29sdW1ucyIsImNyZWF0ZSIsImNvbHVtbk5hbWVzIiwibWFwIiwibyIsIm5hbWUiLCJvcmRlckJ5IiwiZXhpc3RpbmdUYWJsZSIsInVzZXJJbmZvIiwicHVzaCIsImpvaW4iLCJpbmNsdWRlSm9pbmVkTmFtZXMiLCJncGtnSm9pbmVkTmFtZXMiLCJ0YWJsZU5hbWVMaXRlcmFsIiwibGl0ZXJhbCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiZ3BrZ05hbWUiLCJncGtnUGF0aCIsImRlZmF1bHQiLCJncGtnVW5kZXJzY29yZU5hbWVzIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJkYXRhYmFzZU5hbWUiLCJkYXRhYmFzZURpcmVjdG9yeSIsImRpciIsIm9wdGlvbnMiLCJmaWxlIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJKU09OIiwic3RyaW5naWZ5IiwicmVsb2FkVGFibGVMaXN0IiwidGFibGVOYW1lcyIsImV4aXN0aW5nVGFibGVOYW1lIiwiaW5kZXhPZiIsImlzU3BlY2lhbFRhYmxlIiwiZGF0YU5hbWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7QUFDQTs7Ozs7Ozs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0FrRG5CQSxVQWxEbUIscUJBa0ROLGFBQVk7QUFDdkIsWUFBTSxNQUFLQyxRQUFMLEVBQU47O0FBRUEsVUFBSUMsUUFBUUMsSUFBUixDQUFhQyxHQUFqQixFQUFzQjtBQUNwQixjQUFNLE1BQUtDLE1BQUwsQ0FBWUgsUUFBUUMsSUFBUixDQUFhQyxHQUF6QixDQUFOO0FBQ0E7QUFDRDs7QUFFRCxZQUFNRSxVQUFVLE1BQU1KLFFBQVFLLFlBQVIsQ0FBcUJMLFFBQVFDLElBQVIsQ0FBYUssR0FBbEMsQ0FBdEI7O0FBRUEsVUFBSUYsT0FBSixFQUFhO0FBQ1gsY0FBTUcsUUFBUSxNQUFNSCxRQUFRSSxlQUFSLENBQXdCLEVBQXhCLENBQXBCOztBQUVBLGFBQUssTUFBTUMsSUFB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LEVBQW5ELEdBQXVENUcsS0FBSzBDLElBQXpFOztBQUVBLFdBQU9uRCxRQUFRQyxJQUFSLENBQWF1RSxtQkFBYixHQUFtQyx5QkFBTXJCLElBQU4sQ0FBbkMsR0FBaURBLElBQXhEO0FBQ0Q7QUFyV2tCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBTUUxpdGUgfSBmcm9tICdmdWxjcnVtJztcbmltcG9ydCBzbmFrZSBmcm9tICdzbmFrZS1jYXNlJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnZ2VvcGFja2FnZScsXG4gICAgICBkZXNjOiAnY3JlYXRlIGEgZ2VvcGFja2FnZSBkYXRhYmFzZSBmb3IgYW4gb3JnYW5pemF0aW9uJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnTmFtZToge1xuICAgICAgICAgIGRlc2M6ICdkYXRhYmFzZSBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ1BhdGg6IHtcbiAgICAgICAgICBkZXNjOiAnZGF0YWJhc2UgZGlyZWN0b3J5JyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ0Ryb3A6IHtcbiAgICAgICAgICBkZXNjOiAnZHJvcCB0YWJsZXMgZmlyc3QnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBncGtnVW5kZXJzY29yZU5hbWVzOiB7XG4gICAgICAgICAgZGVzYzogJ3VzZSB1bmRlcnNjb3JlIG5hbWVzIChlLmcuIFwiUGFyayBJbnNwZWN0aW9uc1wiIGJlY29tZXMgXCJwYXJrX2luc3BlY3Rpb25zXCIpJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IGZhbHNlXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dVc2VySW5mbzoge1xuICAgICAgICAgIGRlc2M6ICdpbmNsdWRlIHVzZXIgaW5mbycsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dKb2luZWROYW1lczoge1xuICAgICAgICAgIGRlc2M6ICdpbmNsdWRlIHByb2plY3QgbmFtZSBhbmQgYXNzaWdubWVudCBlbWFpbCBvbiByZWNvcmQgdGFibGVzJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBpZiAoZnVsY3J1bS5hcmdzLnNxbCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5TUUwoZnVsY3J1bS5hcmdzLnNxbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGZvcm1zID0gYXdhaXQgYWNjb3VudC5maW5kQWN0aXZlRm9ybXMoe30pO1xuXG4gICAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdVbmFibGUgdG8gZmluZCBhY2NvdW50JywgZnVsY3J1bS5hcmdzLm9yZyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGUoKSB7XG4gICAgY29uc3QgZGVmYXVsdERhdGFiYXNlT3B0aW9ucyA9IHtcbiAgICAgIHdhbDogdHJ1ZSxcbiAgICAgIGF1dG9WYWN1dW06IHRydWUsXG4gICAgICBzeW5jaHJvbm91czogJ29mZidcbiAgICB9O1xuXG4gICAgZnVsY3J1bS5ta2RpcnAoJ2dlb3BhY2thZ2UnKTtcblxuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IGZ1bGNydW0uYXJncy5ncGtnTmFtZSB8fCBmdWxjcnVtLmFyZ3Mub3JnO1xuICAgIGNvbnN0IGRhdGFiYXNlRGlyZWN0b3J5ID0gZnVsY3J1bS5hcmdzLmdwa2dQYXRoIHx8IGZ1bGNydW0uZGlyKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZmlsZTogcGF0aC5qb2luKGRhdGFiYXNlRGlyZWN0b3J5LCBkYXRhYmFzZU5hbWUgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIC8vIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgLy8gZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICBpZiAoZnVsY3J1bS5hcmdzLmRlYnVnKSB7XG4gICAgICBjb25zb2xlLmxvZyhzcWwpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmRiLmV4ZWN1dGUoc3FsKTtcbiAgfVxuXG4gIG9uRm9ybVNhdmUgPSBhc3luYyAoe2Zvcm0sIGFjY291bnQsIG9sZEZvcm0sIG5ld0Zvcm19KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgb25SZWNvcmRzRmluaXNoZWQgPSBhc3luYyAoe2Zvcm0sIGFjY291bnR9KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlUmVjb3JkID0gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShyZWNvcmQuZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVGb3JtID0gYXN5bmMgKGZvcm0sIGFjY291bnQpID0+IHtcbiAgICBjb25zdCByYXdQYXRoID0gZnVsY3J1bS5kYXRhYmFzZUZpbGVQYXRoO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYEFUVEFDSCBEQVRBQkFTRSAnJHtyYXdQYXRofScgYXMgJ2FwcCdgKTtcblxuICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtKSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fdmlld19mdWxsYCwgbnVsbCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpO1xuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlTmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fJHtyZXBlYXRhYmxlLmtleX1fdmlld19mdWxsYCwgcmVwZWF0YWJsZSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYERFVEFDSCBEQVRBQkFTRSAnYXBwJ2ApO1xuXG4gICAgY29uc3QgZHJvcCA9IGZ1bGNydW0uYXJncy5ncGtnRHJvcCAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dEcm9wIDogdHJ1ZTtcblxuICAgIGlmIChkcm9wKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCk7XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlVGFibGUgPSBhc3luYyAodGFibGVOYW1lLCBzb3VyY2VUYWJsZU5hbWUsIHJlcGVhdGFibGUpID0+IHtcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gc291cmNlVGFibGVOYW1lICsgJ190bXAnO1xuXG4gICAgY29uc3QgaW5jbHVkZVVzZXJJbmZvID0gZnVsY3J1bS5hcmdzLmdwa2dVc2VySW5mbyAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dVc2VySW5mbyA6IHRydWU7XG5cbiAgICBsZXQgZHJvcCA9IGZ1bGNydW0uYXJncy5ncGtnRHJvcCAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dEcm9wIDogdHJ1ZTtcblxuICAgIGNvbnN0IGRyb3BUZW1wbGF0ZSA9IGBEUk9QIFRBQkxFIElGIEVYSVNUUyBtYWluLiR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX07YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZVRhYmxlID0gYENSRUFURSBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9IEFTIFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGNyZWF0ZVRlbXBsYXRlVGFibGUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGVtcFRhYmxlTmFtZX0nYCk7XG4gICAgY29uc3Qge2NvbHVtbnN9ID0gYXdhaXQgdGhpcy5kYi5leGVjdXRlKGBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2ApO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZSA9IHJlc3VsdC5zcWwucmVwbGFjZSh0ZW1wVGFibGVOYW1lLCB0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKCcoXFxuJywgJyAoX2lkIElOVEVHRVIgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyk7XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGNvbHVtbnMubWFwKG8gPT4gdGhpcy5kYi5pZGVudChvLm5hbWUpKTtcblxuICAgIGxldCBvcmRlckJ5ID0gJ09SREVSIEJZIF9yZWNvcmRfaWQnO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgIT0gbnVsbCkge1xuICAgICAgb3JkZXJCeSA9ICdPUkRFUiBCWSBfY2hpbGRfcmVjb3JkX2lkJztcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1RhYmxlID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGFibGVOYW1lfSdgKTtcblxuICAgIGxldCBzcWwgPSBbXTtcblxuICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICBsZXQgdXNlckluZm8gPSAnJztcblxuICAgICAgaWYgKGluY2x1ZGVVc2VySW5mbykge1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgfVxuXG4gICAgICBzcWwucHVzaChgRFJPUCBUQUJMRSBJRiBFWElTVFMgbWFpbi4ke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX07YCk7XG5cbiAgICAgIHNxbC5wdXNoKGNyZWF0ZSArICc7Jyk7XG4gICAgfVxuXG4gICAgaWYgKGluY2x1ZGVVc2VySW5mbykge1xuICAgICAgc3FsLnB1c2goYFxuICAgICAgICBJTlNFUlQgSU5UTyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gKCR7Y29sdW1uTmFtZXMuam9pbignLCAnKX0sIF9jcmVhdGVkX2J5X2VtYWlsLCBfdXBkYXRlZF9ieV9lbWFpbClcbiAgICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9LCBtYy5lbWFpbCBBUyBfY3JlYXRlZF9ieV9lbWFpbCwgbXUuZW1haWwgQVMgX3VwZGF0ZWRfYnlfZW1haWxcbiAgICAgICAgRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IHRcbiAgICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG1jIE9OIHQuX2NyZWF0ZWRfYnlfaWQgPSBtYy51c2VyX3Jlc291cmNlX2lkXG4gICAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtdSBPTiB0Ll91cGRhdGVkX2J5X2lkID0gbXUudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgICAke29yZGVyQnl9O1xuICAgICAgYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNxbC5wdXNoKGBcbiAgICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9KVxuICAgICAgICBTRUxFQ1QgJHtjb2x1bW5OYW1lcy5tYXAobyA9PiAndC4nICsgbykuam9pbignLCAnKX1cbiAgICAgICAgRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IHRcbiAgICAgICAgJHtvcmRlckJ5fTtcbiAgICAgIGApO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKHNxbC5qb2luKCdcXG4nKSk7XG5cbiAgICBzcWwgPSBbXTtcblxuICAgIGNvbnN0IGluY2x1ZGVKb2luZWROYW1lcyA9IGZ1bGNydW0uYXJncy5ncGtnSm9pbmVkTmFtZXMgIT0gbnVsbCA/IGZ1bGNydW0uYXJncy5ncGtnSm9pbmVkTmFtZXMgOiB0cnVlO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgPT0gbnVsbCAmJiBpbmNsdWRlSm9pbmVkTmFtZXMpIHtcbiAgICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICAgIHNxbC5wdXNoKGBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9hc3NpZ25lZF90b19lbWFpbCBURVhUO2ApO1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfcHJvamVjdF9uYW1lIFRFWFQ7YCk7XG4gICAgICB9XG5cblxuICAgICAgc3FsLnB1c2goYFxuICAgICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIFNFVCBfYXNzaWduZWRfdG9fZW1haWwgPSAoU0VMRUNUIGVtYWlsIEZST00gYXBwLm1lbWJlcnNoaXBzIG0gV0hFUkUgbS51c2VyX3Jlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9hc3NpZ25lZF90b19pZCksXG4gICAgICAgIF9wcm9qZWN0X25hbWUgPSAoU0VMRUNUIG5hbWUgRlJPTSBhcHAucHJvamVjdHMgcCBXSEVSRSBwLnJlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9wcm9qZWN0X2lkKTtcbiAgICAgIGApO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihzcWwuam9pbignXFxuJykpO1xuICAgIH1cblxuICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWVMaXRlcmFsID0gdGhpcy5kYi5saXRlcmFsKHRhYmxlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGdlb21TUUwgPSBgXG4gICAgICAgIERFTEVURSBGUk9NIGdwa2dfZ2VvbWV0cnlfY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lPSR7dGFibGVOYW1lTGl0ZXJhbH07XG5cbiAgICAgICAgSU5TRVJUIElOVE8gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zXG4gICAgICAgICh0YWJsZV9uYW1lLCBjb2x1bW5fbmFtZSwgZ2VvbWV0cnlfdHlwZV9uYW1lLCBzcnNfaWQsIHosIG0pXG4gICAgICAgIFZBTFVFUyAoJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfZ2VvbSBCTE9CO1xuXG4gICAgICAgIElOU0VSVCBJTlRPIGdwa2dfY29udGVudHMgKHRhYmxlX25hbWUsIGRhdGFfdHlwZSwgaWRlbnRpZmllciwgc3JzX2lkKVxuICAgICAgICBTRUxFQ1QgJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ2ZlYXR1cmVzJywgJHt0YWJsZU5hbWVMaXRlcmFsfSwgNDMyNlxuICAgICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICR7dGFibGVOYW1lTGl0ZXJhbH0pO1xuICAgICAgYDtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4oZ2VvbVNRTCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYFxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuICAgIGApO1xuICB9XG5cbiAgYXN5bmMgZW5hYmxlU3BhdGlhTGl0ZShkYikge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBzcGF0aWFsaXRlUGF0aCA9IG51bGw7XG5cbiAgICAgIC8vIHRoZSBkaWZmZXJlbnQgcGxhdGZvcm1zIGFuZCBjb25maWd1cmF0aW9ucyByZXF1aXJlIHZhcmlvdXMgZGlmZmVyZW50IGxvYWQgcGF0aHMgZm9yIHRoZSBzaGFyZWQgbGlicmFyeVxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEU7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MuZW52LkRFVkVMT1BNRU5UKSB7XG4gICAgICAgIGxldCBwbGF0Zm9ybSA9ICdsaW51eCc7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICd3aW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnbWFjJztcbiAgICAgICAgfVxuXG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKCcuJywgJ3Jlc291cmNlcycsICdzcGF0aWFsaXRlJywgcGxhdGZvcm0sIHByb2Nlc3MuYXJjaCwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uJywgJ1Jlc291cmNlcycsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gJ21vZF9zcGF0aWFsaXRlJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRiLmRhdGFiYXNlLmxvYWRFeHRlbnNpb24oc3BhdGlhbGl0ZVBhdGgsIChlcnIpID0+IGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNoZWNrID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBDaGVja0dlb1BhY2thZ2VNZXRhRGF0YSgpIEFTIHJlc3VsdCcpO1xuXG4gICAgaWYgKGNoZWNrWzBdLnJlc3VsdCAhPT0gMSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgZ3BrZ0NyZWF0ZUJhc2VUYWJsZXMoKScpO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIEVuYWJsZUdwa2dNb2RlKCkgQVMgZW5hYmxlZCwgR2V0R3BrZ01vZGUoKSBBUyBtb2RlJyk7XG5cbiAgICBpZiAobW9kZVswXS5tb2RlICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgdmVyaWZ5aW5nIHRoZSBHUEtHIG1vZGUnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBydW5TUUwoc3FsKSB7XG4gICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5hbGwoc3FsKTtcbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmVzdWx0ID0ge2Vycm9yOiBleC5tZXNzYWdlfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgfVxuXG4gIGFzeW5jIGNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCkge1xuICAgIGF3YWl0IHRoaXMucmVsb2FkVGFibGVMaXN0KCk7XG5cbiAgICBjb25zdCB0YWJsZU5hbWVzID0gW107XG5cbiAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgdGFibGVOYW1lcy5wdXNoKHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSkpO1xuXG4gICAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgICAgdGFibGVOYW1lcy5wdXNoKHRhYmxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gZmluZCBhbnkgdGFibGVzIHRoYXQgc2hvdWxkIGJlIGRyb3BwZWQgYmVjYXVzZSB0aGV5IGdvdCByZW5hbWVkXG4gICAgZm9yIChjb25zdCBleGlzdGluZ1RhYmxlTmFtZSBvZiB0aGlzLnRhYmxlTmFtZXMpIHtcbiAgICAgIGlmICh0YWJsZU5hbWVzLmluZGV4T2YoZXhpc3RpbmdUYWJsZU5hbWUpID09PSAtMSAmJiAhdGhpcy5pc1NwZWNpYWxUYWJsZShleGlzdGluZ1RhYmxlTmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW4oYERST1AgVEFCTEUgSUYgRVhJU1RTIG1haW4uJHt0aGlzLmRiLmlkZW50KGV4aXN0aW5nVGFibGVOYW1lKX07YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaXNTcGVjaWFsVGFibGUodGFibGVOYW1lKSB7XG4gICAgaWYgKHRhYmxlTmFtZS5pbmRleE9mKCdncGtnXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ3NxbGl0ZV8nKSA9PT0gMCB8fFxuICAgICAgICAgIHRhYmxlTmFtZS5pbmRleE9mKCdjdXN0b21fJykgPT09IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJlbG9hZFRhYmxlTGlzdCgpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoXCJTRUxFQ1QgdGJsX25hbWUgQVMgbmFtZSBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdHlwZSA9ICd0YWJsZSc7XCIpO1xuXG4gICAgdGhpcy50YWJsZU5hbWVzID0gcm93cy5tYXAobyA9PiBvLm5hbWUpO1xuICB9XG5cbiAgZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSkge1xuICAgIGNvbnN0IG5hbWUgPSByZXBlYXRhYmxlID8gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gIDogZm9ybS5uYW1lO1xuXG4gICAgcmV0dXJuIGZ1bGNydW0uYXJncy5ncGtnVW5kZXJzY29yZU5hbWVzID8gc25ha2UobmFtZSkgOiBuYW1lO1xuICB9XG59XG4iXX0=