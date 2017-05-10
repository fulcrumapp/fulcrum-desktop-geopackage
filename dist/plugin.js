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

        const allSQL = `
      DROP TABLE IF EXISTS ${_this.db.ident(tableName)};

      ${create};

      ALTER TABLE ${_this.db.ident(tableName)}
      ADD _created_by_email TEXT;

      ALTER TABLE ${_this.db.ident(tableName)}
      ADD _updated_by_email TEXT;

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
          const parentSQL = `
        ALTER TABLE ${_this.db.ident(tableName)}
        ADD _assigned_to_email TEXT;

        ALTER TABLE ${_this.db.ident(tableName)}
        ADD _project_name TEXT;

        UPDATE ${_this.db.ident(tableName)}
        SET _assigned_to_email = (SELECT email FROM app.memberships m WHERE m.user_resource_id = ${_this.db.ident(tableName)}._assigned_to_id),
        _project_name = (SELECT name FROM app.projects p WHERE p.resource_id = ${_this.db.ident(tableName)}._project_id);
      `;

          yield _this.run(parentSQL);
        }

        const tableNameLiteral = _this.db.literal(tableName);

        const geomSQL = `
      DELETE FROM gpkg_geometry_columns WHERE table_name=${tableNameLiteral};

      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id, z, m)
      VALUES (${tableNameLiteral}, '_geom', 'POINT', 4326, 0, 0);

      ALTER TABLE ${_this.db.ident(tableName)} ADD _geom BLOB;

      UPDATE ${_this.db.ident(tableName)}
      SET _geom = gpkgMakePoint(_longitude, _latitude, 4326);

      INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
      SELECT ${tableNameLiteral}, 'features', ${tableNameLiteral}, 4326
      WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = ${tableNameLiteral});
    `;

        yield _this.run(geomSQL);
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

      const options = {
        file: _path2.default.join(fulcrum.dir('geopackage'), fulcrum.args.org + '.gpkg')
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJuYW1lIiwib3JkZXJCeSIsImFsbFNRTCIsImpvaW4iLCJwYXJlbnRTUUwiLCJ0YWJsZU5hbWVMaXRlcmFsIiwibGl0ZXJhbCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJvcHRpb25zIiwiZmlsZSIsImRpciIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwib24iLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5IiwicmVsb2FkVGFibGVMaXN0IiwidGFibGVOYW1lcyIsInB1c2giLCJleGlzdGluZ1RhYmxlTmFtZSIsImluZGV4T2YiLCJpc1NwZWNpYWxUYWJsZSIsImRhdGFOYW1lIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQWdCbkJBLFVBaEJtQixxQkFnQk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxVQUFJQyxRQUFRQyxJQUFSLENBQWFDLEdBQWpCLEVBQXNCO0FBQ3BCLGNBQU0sTUFBS0MsTUFBTCxDQUFZSCxRQUFRQyxJQUFSLENBQWFDLEdBQXpCLENBQU47QUFDQTtBQUNEOztBQUVELFlBQU1FLFVBQVUsTUFBTUosUUFBUUssWUFBUixDQUFxQkwsUUFBUUMsSUFBUixDQUFhSyxHQUFsQyxDQUF0Qjs7QUFFQSxVQUFJRixPQUFKLEVBQWE7QUFDWCxjQUFNRyxRQUFRLE1BQU1ILFFBQVFJLGVBQVIsQ0FBd0IsRUFBeEIsQ0FBcEI7O0FBRUEsYUFBSyxNQUFNQyxJQUFYLElBQW1CRixLQUFuQixFQUEwQjtBQUN4QixnQkFBTSxNQUFLRyxVQUFMLENBQWdCRCxJQUFoQixFQUFzQkwsT0FBdEIsQ0FBTjtBQUNEO0FBQ0YsT0FORCxNQU1PO0FBQ0xPLGdCQUFRQyxLQUFSLENBQWMsd0JBQWQsRUFBd0NaLFFBQVFDLElBQVIsQ0FBYUssR0FBckQ7QUFDRDtBQUNGLEtBbkNrQjs7QUFBQSxTQWdFbkJPLEdBaEVtQixHQWdF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QXBCLENBQXJELEVBQTZGO0FBQzNGLGdCQUFNLE9BQUt6RixHQUFMLENBQVUsd0JBQXVCLE9BQUtFLEVBQUwsQ0FBUXFCLEtBQVIsQ0FBY2tFLGlCQUFkLENBQWlDLEdBQWxFLENBQU47QUFDRDtBQUNGO0FBdEJnQztBQXVCbEM7O0FBRURFLGlCQUFlMUUsU0FBZixFQUEwQjtBQUN4QixRQUFJQSxVQUFVeUUsT0FBVixDQUFrQixPQUFsQixNQUErQixDQUEvQixJQUNFekUsVUFBVXlFLE9BQVYsQ0FBa0IsU0FBbEIsTUFBaUMsQ0FEbkMsSUFFRXpFLFVBQVV5RSxPQUFWLENBQWtCLFNBQWxCLE1BQWlDLENBRnZDLEVBRTBDO0FBQ3hDLGFBQU8sSUFBUDtBQUNEOztBQUVELFdBQU8sS0FBUDtBQUNEOztBQUVLSixpQkFBTixHQUF3QjtBQUFBOztBQUFBO0FBQ3RCLFlBQU1SLE9BQU8sTUFBTSxPQUFLNUUsRUFBTCxDQUFRMkUsR0FBUixDQUFZLGtFQUFaLENBQW5COztBQUVBLGFBQUtVLFVBQUwsR0FBa0JULEtBQUtoRCxHQUFMLENBQVM7QUFBQSxlQUFLQyxFQUFFQyxJQUFQO0FBQUEsT0FBVCxDQUFsQjtBQUhzQjtBQUl2Qjs7QUFFRG5CLHVCQUFxQmpCLElBQXJCLEVBQTJCbUIsVUFBM0IsRUFBdUM7QUFDckMsV0FBT0EsYUFBYyxHQUFFbkIsS0FBS29DLElBQUssTUFBS2pCLFdBQVc2RSxRQUFTLEVBQW5ELEdBQXVEaEcsS0FBS29DLElBQW5FO0FBQ0Q7QUExUmtCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBTUUxpdGUgfSBmcm9tICdmdWxjcnVtJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnZ2VvcGFja2FnZScsXG4gICAgICBkZXNjOiAnY3JlYXRlIGEgZ2VvcGFja2FnZSBkYXRhYmFzZSBmb3IgYW4gb3JnYW5pemF0aW9uJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3Muc3FsKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blNRTChmdWxjcnVtLmFyZ3Muc3FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICBjb25zdCBkZWZhdWx0RGF0YWJhc2VPcHRpb25zID0ge1xuICAgICAgd2FsOiB0cnVlLFxuICAgICAgYXV0b1ZhY3V1bTogdHJ1ZSxcbiAgICAgIHN5bmNocm9ub3VzOiAnb2ZmJ1xuICAgIH07XG5cbiAgICBmdWxjcnVtLm1rZGlycCgnZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpLCBmdWxjcnVtLmFyZ3Mub3JnICsgJy5ncGtnJylcbiAgICB9O1xuXG4gICAgdGhpcy5kYiA9IGF3YWl0IFNRTGl0ZS5vcGVuKHsuLi5kZWZhdWx0RGF0YWJhc2VPcHRpb25zLCAuLi5vcHRpb25zfSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuYWJsZVNwYXRpYUxpdGUodGhpcy5kYik7XG5cbiAgICBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICAgIGlmICh0aGlzLmRiKSB7XG4gICAgICBhd2FpdCB0aGlzLmRiLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgcnVuID0gKHNxbCkgPT4ge1xuICAgIHNxbCA9IHNxbC5yZXBsYWNlKC9cXDAvZywgJycpO1xuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV92aWV3X2Z1bGxgLCBudWxsKTtcblxuICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBjb25zdCBkcm9wVGVtcGxhdGUgPSBgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfTtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlVGFibGUgPSBgQ1JFQVRFIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX0gQVMgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oY3JlYXRlVGVtcGxhdGVUYWJsZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmdldChgU0VMRUNUIHNxbCBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdGJsX25hbWUgPSAnJHt0ZW1wVGFibGVOYW1lfSdgKTtcbiAgICBjb25zdCB7Y29sdW1uc30gPSBhd2FpdCB0aGlzLmRiLmV4ZWN1dGUoYFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YCk7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlID0gcmVzdWx0LnNxbC5yZXBsYWNlKHRlbXBUYWJsZU5hbWUsIHRoaXMuZGIuaWRlbnQodGFibGVOYW1lKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoJyhcXG4nLCAnIChfaWQgSU5URUdFUiBQUklNQVJZIEtFWSBBVVRPSU5DUkVNRU5ULCAnKTtcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gY29sdW1ucy5tYXAobyA9PiB0aGlzLmRiLmlkZW50KG8ubmFtZSkpO1xuXG4gICAgbGV0IG9yZGVyQnkgPSAnT1JERVIgQlkgX3JlY29yZF9pZCc7XG5cbiAgICBpZiAocmVwZWF0YWJsZSAhPSBudWxsKSB7XG4gICAgICBvcmRlckJ5ID0gJ09SREVSIEJZIF9jaGlsZF9yZWNvcmRfaWQnO1xuICAgIH1cblxuICAgIGNvbnN0IGFsbFNRTCA9IGBcbiAgICAgIERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtcblxuICAgICAgJHsgY3JlYXRlIH07XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF9jcmVhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF91cGRhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSwgX2NyZWF0ZWRfYnlfZW1haWwsIF91cGRhdGVkX2J5X2VtYWlsKVxuICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9LCBtYy5lbWFpbCBBUyBfY3JlYXRlZF9ieV9lbWFpbCwgbXUuZW1haWwgQVMgX3VwZGF0ZWRfYnlfZW1haWxcbiAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbWMgT04gdC5fY3JlYXRlZF9ieV9pZCA9IG1jLnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtdSBPTiB0Ll91cGRhdGVkX2J5X2lkID0gbXUudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgJHtvcmRlckJ5fTtcbiAgICBgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYWxsU1FMKTtcblxuICAgIGlmIChyZXBlYXRhYmxlID09IG51bGwpIHtcbiAgICAgIGNvbnN0IHBhcmVudFNRTCA9IGBcbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfYXNzaWduZWRfdG9fZW1haWwgVEVYVDtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9wcm9qZWN0X25hbWUgVEVYVDtcblxuICAgICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIFNFVCBfYXNzaWduZWRfdG9fZW1haWwgPSAoU0VMRUNUIGVtYWlsIEZST00gYXBwLm1lbWJlcnNoaXBzIG0gV0hFUkUgbS51c2VyX3Jlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9hc3NpZ25lZF90b19pZCksXG4gICAgICAgIF9wcm9qZWN0X25hbWUgPSAoU0VMRUNUIG5hbWUgRlJPTSBhcHAucHJvamVjdHMgcCBXSEVSRSBwLnJlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9wcm9qZWN0X2lkKTtcbiAgICAgIGA7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKHBhcmVudFNRTCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVOYW1lTGl0ZXJhbCA9IHRoaXMuZGIubGl0ZXJhbCh0YWJsZU5hbWUpO1xuXG4gICAgY29uc3QgZ2VvbVNRTCA9IGBcbiAgICAgIERFTEVURSBGUk9NIGdwa2dfZ2VvbWV0cnlfY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lPSR7dGFibGVOYW1lTGl0ZXJhbH07XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgIFZBTFVFUyAoJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuXG4gICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgIFNFTEVDVCAke3RhYmxlTmFtZUxpdGVyYWx9LCAnZmVhdHVyZXMnLCAke3RhYmxlTmFtZUxpdGVyYWx9LCA0MzI2XG4gICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICR7dGFibGVOYW1lTGl0ZXJhbH0pO1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBsZXQgcGxhdGZvcm0gPSAnbGludXgnO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnd2luJztcbiAgICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ21hYyc7XG4gICAgICAgIH1cblxuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsIHBsYXRmb3JtLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cblxuICBhc3luYyBjbGVhbnVwVGFibGVzKGZvcm0sIGFjY291bnQpIHtcbiAgICBhd2FpdCB0aGlzLnJlbG9hZFRhYmxlTGlzdCgpO1xuXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IFtdO1xuXG4gICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgIHRhYmxlTmFtZXMucHVzaCh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pKTtcblxuICAgICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpO1xuXG4gICAgICAgIHRhYmxlTmFtZXMucHVzaCh0YWJsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGZpbmQgYW55IHRhYmxlcyB0aGF0IHNob3VsZCBiZSBkcm9wcGVkIGJlY2F1c2UgdGhleSBnb3QgcmVuYW1lZFxuICAgIGZvciAoY29uc3QgZXhpc3RpbmdUYWJsZU5hbWUgb2YgdGhpcy50YWJsZU5hbWVzKSB7XG4gICAgICBpZiAodGFibGVOYW1lcy5pbmRleE9mKGV4aXN0aW5nVGFibGVOYW1lKSA9PT0gLTEgJiYgIXRoaXMuaXNTcGVjaWFsVGFibGUoZXhpc3RpbmdUYWJsZU5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuKGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQoZXhpc3RpbmdUYWJsZU5hbWUpfTtgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpc1NwZWNpYWxUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBpZiAodGFibGVOYW1lLmluZGV4T2YoJ2dwa2dfJykgPT09IDAgfHxcbiAgICAgICAgICB0YWJsZU5hbWUuaW5kZXhPZignc3FsaXRlXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ2N1c3RvbV8nKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcmVsb2FkVGFibGVMaXN0KCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbChcIlNFTEVDVCB0YmxfbmFtZSBBUyBuYW1lIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0eXBlID0gJ3RhYmxlJztcIik7XG5cbiAgICB0aGlzLnRhYmxlTmFtZXMgPSByb3dzLm1hcChvID0+IG8ubmFtZSk7XG4gIH1cblxuICBnZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKSB7XG4gICAgcmV0dXJuIHJlcGVhdGFibGUgPyBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWAgOiBmb3JtLm5hbWU7XG4gIH1cbn1cbiJdfQ==