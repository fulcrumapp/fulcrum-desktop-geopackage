'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fulcrumDesktopPlugin = require('fulcrum-desktop-plugin');

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

        yield _this.cleanupTables(form, account);
      });

      return function (_x4, _x5) {
        return _ref5.apply(this, arguments);
      };
    })();

    this.updateTable = (() => {
      var _ref6 = _asyncToGenerator(function* (tableName, sourceTableName, repeatable) {
        const tempTableName = sourceTableName + '_tmp';

        let drop = fulcrum.args.drop != null ? fulcrum.args.drop : true;

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

        let prologue = '';

        const existingTable = yield _this.db.get(`SELECT sql FROM sqlite_master WHERE tbl_name = '${tableName}'`);

        if (drop || !existingTable) {
          prologue = `
        DROP TABLE IF EXISTS ${_this.db.ident(tableName)};

        ${create};

        ALTER TABLE ${_this.db.ident(tableName)}
        ADD _created_by_email TEXT;

        ALTER TABLE ${_this.db.ident(tableName)}
        ADD _updated_by_email TEXT;
      `;
        }

        const allSQL = `
      ${prologue}

      INSERT INTO ${_this.db.ident(tableName)} (${columnNames.join(', ')}, _created_by_email, _updated_by_email)
      SELECT ${columnNames.map(function (o) {
          return 't.' + o;
        }).join(', ')}, mc.email AS _created_by_email, mu.email AS _updated_by_email
      FROM app.${sourceTableName} t
      LEFT JOIN memberships mc ON t._created_by_id = mc.user_resource_id
      LEFT JOIN memberships mu ON t._updated_by_id = mu.user_resource_id
      ${orderBy};
    `;

        yield _this.run(allSQL);

        if (repeatable == null) {
          prologue = '';

          if (drop || !existingTable) {
            prologue = `
          ALTER TABLE ${_this.db.ident(tableName)}
          ADD _assigned_to_email TEXT;

          ALTER TABLE ${_this.db.ident(tableName)}
          ADD _project_name TEXT;
        `;
          }

          const parentSQL = `
        ${prologue}

        UPDATE ${_this.db.ident(tableName)}
        SET _assigned_to_email = (SELECT email FROM app.memberships m WHERE m.user_resource_id = ${_this.db.ident(tableName)}._assigned_to_id),
        _project_name = (SELECT name FROM app.projects p WHERE p.resource_id = ${_this.db.ident(tableName)}._project_id);
      `;

          yield _this.run(parentSQL);
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
          drop: {
            desc: 'drop tables first',
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

      fulcrum.on('form:save', _this3.onFormSave);
      fulcrum.on('records:finish', _this3.onRecordsFinished);
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
    return repeatable ? `${form.name} - ${repeatable.dataName}` : form.name;
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3AiLCJkcm9wVGVtcGxhdGUiLCJpZGVudCIsImNyZWF0ZVRlbXBsYXRlVGFibGUiLCJyZXN1bHQiLCJnZXQiLCJjb2x1bW5zIiwiY3JlYXRlIiwiY29sdW1uTmFtZXMiLCJtYXAiLCJvIiwibmFtZSIsIm9yZGVyQnkiLCJwcm9sb2d1ZSIsImV4aXN0aW5nVGFibGUiLCJhbGxTUUwiLCJqb2luIiwicGFyZW50U1FMIiwidGFibGVOYW1lTGl0ZXJhbCIsImxpdGVyYWwiLCJnZW9tU1FMIiwidGFzayIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwidHlwZSIsImdwa2dOYW1lIiwiZ3BrZ1BhdGgiLCJkZWZhdWx0IiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJkYXRhYmFzZU5hbWUiLCJkYXRhYmFzZURpcmVjdG9yeSIsImRpciIsIm9wdGlvbnMiLCJmaWxlIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJvbiIsImRlYWN0aXZhdGUiLCJjbG9zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3BhdGlhbGl0ZVBhdGgiLCJwcm9jZXNzIiwiZW52IiwiTU9EX1NQQVRJQUxJVEUiLCJERVZFTE9QTUVOVCIsInBsYXRmb3JtIiwiYXJjaCIsImRpcm5hbWUiLCJleGVjUGF0aCIsImRhdGFiYXNlIiwibG9hZEV4dGVuc2lvbiIsImVyciIsImNoZWNrIiwiYWxsIiwicm93cyIsIm1vZGUiLCJFcnJvciIsImV4IiwibWVzc2FnZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJyZWxvYWRUYWJsZUxpc3QiLCJ0YWJsZU5hbWVzIiwicHVzaCIsImV4aXN0aW5nVGFibGVOYW1lIiwiaW5kZXhPZiIsImlzU3BlY2lhbFRhYmxlIiwiZGF0YU5hbWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBZ0NuQkEsVUFoQ21CLHFCQWdDTixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVBLFVBQUlDLFFBQVFDLElBQVIsQ0FBYUMsR0FBakIsRUFBc0I7QUFDcEIsY0FBTSxNQUFLQyxNQUFMLENBQVlILFFBQVFDLElBQVIsQ0FBYUMsR0FBekIsQ0FBTjtBQUNBO0FBQ0Q7O0FBRUQsWUFBTUUsVUFBVSxNQUFNSixRQUFRSyxZQUFSLENBQXFCTCxRQUFRQyxJQUFSLENBQWFLLEdBQWxDLENBQXRCOztBQUVBLFVBQUlGLE9BQUosRUFBYTtBQUNYLGNBQU1HLFFBQVEsTUFBTUgsUUFBUUksZUFBUixDQUF3QixFQUF4QixDQUFwQjs7QUFFQSxhQUFLLE1BQU1DLElBQVgsSUFBbUJGLEtBQW5CLEVBQTBCO0FBQ3hCLGdCQUFNLE1BQUtHLFVBQUwsQ0FBZ0JELElBQWhCLEVBQXNCTCxPQUF0QixDQUFOO0FBQ0Q7QUFDRixPQU5ELE1BTU87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QUFNLE9BQUtqRyxHQUFMLENBQVUsd0JBQXVCLE9BQUtFLEVBQUwsQ0FBUXNCLEtBQVIsQ0FBY3lFLGlCQUFkLENBQWlDLEdBQWxFLENBQU47QUFDRDtBQUNGO0FBdEJnQztBQXVCbEM7O0FBRURFLGlCQUFlbEYsU0FBZixFQUEwQjtBQUN4QixRQUFJQSxVQUFVaUYsT0FBVixDQUFrQixPQUFsQixNQUErQixDQUEvQixJQUNFakYsVUFBVWlGLE9BQVYsQ0FBa0IsU0FBbEIsTUFBaUMsQ0FEbkMsSUFFRWpGLFVBQVVpRixPQUFWLENBQWtCLFNBQWxCLE1BQWlDLENBRnZDLEVBRTBDO0FBQ3hDLGFBQU8sSUFBUDtBQUNEOztBQUVELFdBQU8sS0FBUDtBQUNEOztBQUVLSixpQkFBTixHQUF3QjtBQUFBOztBQUFBO0FBQ3RCLFlBQU1SLE9BQU8sTUFBTSxPQUFLcEYsRUFBTCxDQUFRbUYsR0FBUixDQUFZLGtFQUFaLENBQW5COztBQUVBLGFBQUtVLFVBQUwsR0FBa0JULEtBQUt2RCxHQUFMLENBQVM7QUFBQSxlQUFLQyxFQUFFQyxJQUFQO0FBQUEsT0FBVCxDQUFsQjtBQUhzQjtBQUl2Qjs7QUFFRHBCLHVCQUFxQmpCLElBQXJCLEVBQTJCbUIsVUFBM0IsRUFBdUM7QUFDckMsV0FBT0EsYUFBYyxHQUFFbkIsS0FBS3FDLElBQUssTUFBS2xCLFdBQVdxRixRQUFTLEVBQW5ELEdBQXVEeEcsS0FBS3FDLElBQW5FO0FBQ0Q7QUFyVWtCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBTUUxpdGUgfSBmcm9tICdmdWxjcnVtJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnZ2VvcGFja2FnZScsXG4gICAgICBkZXNjOiAnY3JlYXRlIGEgZ2VvcGFja2FnZSBkYXRhYmFzZSBmb3IgYW4gb3JnYW5pemF0aW9uJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnTmFtZToge1xuICAgICAgICAgIGRlc2M6ICdkYXRhYmFzZSBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ1BhdGg6IHtcbiAgICAgICAgICBkZXNjOiAnZGF0YWJhc2UgZGlyZWN0b3J5JyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgZHJvcDoge1xuICAgICAgICAgIGRlc2M6ICdkcm9wIHRhYmxlcyBmaXJzdCcsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSBmdWxjcnVtLmFyZ3MuZ3BrZ05hbWUgfHwgZnVsY3J1bS5hcmdzLm9yZztcbiAgICBjb25zdCBkYXRhYmFzZURpcmVjdG9yeSA9IGZ1bGNydW0uYXJncy5ncGtnUGF0aCB8fCBmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihkYXRhYmFzZURpcmVjdG9yeSwgZGF0YWJhc2VOYW1lICsgJy5ncGtnJylcbiAgICB9O1xuXG4gICAgdGhpcy5kYiA9IGF3YWl0IFNRTGl0ZS5vcGVuKHsuLi5kZWZhdWx0RGF0YWJhc2VPcHRpb25zLCAuLi5vcHRpb25zfSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuYWJsZVNwYXRpYUxpdGUodGhpcy5kYik7XG5cbiAgICBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICAgIGlmICh0aGlzLmRiKSB7XG4gICAgICBhd2FpdCB0aGlzLmRiLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgcnVuID0gKHNxbCkgPT4ge1xuICAgIHNxbCA9IHNxbC5yZXBsYWNlKC9cXDAvZywgJycpO1xuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV92aWV3X2Z1bGxgLCBudWxsKTtcblxuICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBsZXQgZHJvcCA9IGZ1bGNydW0uYXJncy5kcm9wICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZHJvcCA6IHRydWU7XG5cbiAgICBjb25zdCBkcm9wVGVtcGxhdGUgPSBgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfTtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlVGFibGUgPSBgQ1JFQVRFIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX0gQVMgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oY3JlYXRlVGVtcGxhdGVUYWJsZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmdldChgU0VMRUNUIHNxbCBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdGJsX25hbWUgPSAnJHt0ZW1wVGFibGVOYW1lfSdgKTtcbiAgICBjb25zdCB7Y29sdW1uc30gPSBhd2FpdCB0aGlzLmRiLmV4ZWN1dGUoYFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YCk7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlID0gcmVzdWx0LnNxbC5yZXBsYWNlKHRlbXBUYWJsZU5hbWUsIHRoaXMuZGIuaWRlbnQodGFibGVOYW1lKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoJyhcXG4nLCAnIChfaWQgSU5URUdFUiBQUklNQVJZIEtFWSBBVVRPSU5DUkVNRU5ULCAnKTtcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gY29sdW1ucy5tYXAobyA9PiB0aGlzLmRiLmlkZW50KG8ubmFtZSkpO1xuXG4gICAgbGV0IG9yZGVyQnkgPSAnT1JERVIgQlkgX3JlY29yZF9pZCc7XG5cbiAgICBpZiAocmVwZWF0YWJsZSAhPSBudWxsKSB7XG4gICAgICBvcmRlckJ5ID0gJ09SREVSIEJZIF9jaGlsZF9yZWNvcmRfaWQnO1xuICAgIH1cblxuICAgIGxldCBwcm9sb2d1ZSA9ICcnO1xuXG4gICAgY29uc3QgZXhpc3RpbmdUYWJsZSA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RhYmxlTmFtZX0nYCk7XG5cbiAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgcHJvbG9ndWUgPSBgXG4gICAgICAgIERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtcblxuICAgICAgICAkeyBjcmVhdGUgfTtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9jcmVhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO1xuICAgICAgYDtcbiAgICB9XG5cbiAgICBjb25zdCBhbGxTUUwgPSBgXG4gICAgICAkeyBwcm9sb2d1ZSB9XG5cbiAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSwgX2NyZWF0ZWRfYnlfZW1haWwsIF91cGRhdGVkX2J5X2VtYWlsKVxuICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9LCBtYy5lbWFpbCBBUyBfY3JlYXRlZF9ieV9lbWFpbCwgbXUuZW1haWwgQVMgX3VwZGF0ZWRfYnlfZW1haWxcbiAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbWMgT04gdC5fY3JlYXRlZF9ieV9pZCA9IG1jLnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtdSBPTiB0Ll91cGRhdGVkX2J5X2lkID0gbXUudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgJHtvcmRlckJ5fTtcbiAgICBgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYWxsU1FMKTtcblxuICAgIGlmIChyZXBlYXRhYmxlID09IG51bGwpIHtcbiAgICAgIHByb2xvZ3VlID0gJyc7XG5cbiAgICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICAgIHByb2xvZ3VlID0gYFxuICAgICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICAgIEFERCBfYXNzaWduZWRfdG9fZW1haWwgVEVYVDtcblxuICAgICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICAgIEFERCBfcHJvamVjdF9uYW1lIFRFWFQ7XG4gICAgICAgIGA7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudFNRTCA9IGBcbiAgICAgICAgJHsgcHJvbG9ndWUgfVxuXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgU0VUIF9hc3NpZ25lZF90b19lbWFpbCA9IChTRUxFQ1QgZW1haWwgRlJPTSBhcHAubWVtYmVyc2hpcHMgbSBXSEVSRSBtLnVzZXJfcmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX2Fzc2lnbmVkX3RvX2lkKSxcbiAgICAgICAgX3Byb2plY3RfbmFtZSA9IChTRUxFQ1QgbmFtZSBGUk9NIGFwcC5wcm9qZWN0cyBwIFdIRVJFIHAucmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX3Byb2plY3RfaWQpO1xuICAgICAgYDtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4ocGFyZW50U1FMKTtcbiAgICB9XG5cbiAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lTGl0ZXJhbCA9IHRoaXMuZGIubGl0ZXJhbCh0YWJsZU5hbWUpO1xuXG4gICAgICBjb25zdCBnZW9tU1FMID0gYFxuICAgICAgICBERUxFVEUgRlJPTSBncGtnX2dlb21ldHJ5X2NvbHVtbnMgV0hFUkUgdGFibGVfbmFtZT0ke3RhYmxlTmFtZUxpdGVyYWx9O1xuXG4gICAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgICAodGFibGVfbmFtZSwgY29sdW1uX25hbWUsIGdlb21ldHJ5X3R5cGVfbmFtZSwgc3JzX2lkLCB6LCBtKVxuICAgICAgICBWQUxVRVMgKCR7dGFibGVOYW1lTGl0ZXJhbH0sICdfZ2VvbScsICdQT0lOVCcsIDQzMjYsIDAsIDApO1xuXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgICAgU0VMRUNUICR7dGFibGVOYW1lTGl0ZXJhbH0sICdmZWF0dXJlcycsICR7dGFibGVOYW1lTGl0ZXJhbH0sIDQzMjZcbiAgICAgICAgV0hFUkUgTk9UIEVYSVNUUyAoU0VMRUNUIDEgRlJPTSBncGtnX2NvbnRlbnRzIFdIRVJFIHRhYmxlX25hbWUgPSAke3RhYmxlTmFtZUxpdGVyYWx9KTtcbiAgICAgIGA7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKGdlb21TUUwpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKGBcbiAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIFNFVCBfZ2VvbSA9IGdwa2dNYWtlUG9pbnQoX2xvbmdpdHVkZSwgX2xhdGl0dWRlLCA0MzI2KTtcbiAgICBgKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBsZXQgcGxhdGZvcm0gPSAnbGludXgnO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnd2luJztcbiAgICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ21hYyc7XG4gICAgICAgIH1cblxuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsIHBsYXRmb3JtLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cblxuICBhc3luYyBjbGVhbnVwVGFibGVzKGZvcm0sIGFjY291bnQpIHtcbiAgICBhd2FpdCB0aGlzLnJlbG9hZFRhYmxlTGlzdCgpO1xuXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IFtdO1xuXG4gICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgIHRhYmxlTmFtZXMucHVzaCh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pKTtcblxuICAgICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpO1xuXG4gICAgICAgIHRhYmxlTmFtZXMucHVzaCh0YWJsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGZpbmQgYW55IHRhYmxlcyB0aGF0IHNob3VsZCBiZSBkcm9wcGVkIGJlY2F1c2UgdGhleSBnb3QgcmVuYW1lZFxuICAgIGZvciAoY29uc3QgZXhpc3RpbmdUYWJsZU5hbWUgb2YgdGhpcy50YWJsZU5hbWVzKSB7XG4gICAgICBpZiAodGFibGVOYW1lcy5pbmRleE9mKGV4aXN0aW5nVGFibGVOYW1lKSA9PT0gLTEgJiYgIXRoaXMuaXNTcGVjaWFsVGFibGUoZXhpc3RpbmdUYWJsZU5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuKGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQoZXhpc3RpbmdUYWJsZU5hbWUpfTtgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpc1NwZWNpYWxUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBpZiAodGFibGVOYW1lLmluZGV4T2YoJ2dwa2dfJykgPT09IDAgfHxcbiAgICAgICAgICB0YWJsZU5hbWUuaW5kZXhPZignc3FsaXRlXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ2N1c3RvbV8nKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcmVsb2FkVGFibGVMaXN0KCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbChcIlNFTEVDVCB0YmxfbmFtZSBBUyBuYW1lIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0eXBlID0gJ3RhYmxlJztcIik7XG5cbiAgICB0aGlzLnRhYmxlTmFtZXMgPSByb3dzLm1hcChvID0+IG8ubmFtZSk7XG4gIH1cblxuICBnZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKSB7XG4gICAgcmV0dXJuIHJlcGVhdGFibGUgPyBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWAgOiBmb3JtLm5hbWU7XG4gIH1cbn1cbiJdfQ==