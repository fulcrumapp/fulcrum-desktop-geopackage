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
    if (tableName.indexOf('gpkg_') === 0) {
      return true;
    }

    if (tableName.indexOf('sqlite_') === 0) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJuYW1lIiwib3JkZXJCeSIsImFsbFNRTCIsImpvaW4iLCJwYXJlbnRTUUwiLCJ0YWJsZU5hbWVMaXRlcmFsIiwibGl0ZXJhbCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJvcHRpb25zIiwiZmlsZSIsImRpciIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwib24iLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5IiwicmVsb2FkVGFibGVMaXN0IiwidGFibGVOYW1lcyIsInB1c2giLCJleGlzdGluZ1RhYmxlTmFtZSIsImluZGV4T2YiLCJpc1NwZWNpYWxUYWJsZSIsImRhdGFOYW1lIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQWdCbkJBLFVBaEJtQixxQkFnQk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxVQUFJQyxRQUFRQyxJQUFSLENBQWFDLEdBQWpCLEVBQXNCO0FBQ3BCLGNBQU0sTUFBS0MsTUFBTCxDQUFZSCxRQUFRQyxJQUFSLENBQWFDLEdBQXpCLENBQU47QUFDQTtBQUNEOztBQUVELFlBQU1FLFVBQVUsTUFBTUosUUFBUUssWUFBUixDQUFxQkwsUUFBUUMsSUFBUixDQUFhSyxHQUFsQyxDQUF0Qjs7QUFFQSxVQUFJRixPQUFKLEVBQWE7QUFDWCxjQUFNRyxRQUFRLE1BQU1ILFFBQVFJLGVBQVIsQ0FBd0IsRUFBeEIsQ0FBcEI7O0FBRUEsYUFBSyxNQUFNQyxJQUFYLElBQW1CRixLQUFuQixFQUEwQjtBQUN4QixnQkFBTSxNQUFLRyxVQUFMLENBQWdCRCxJQUFoQixFQUFzQkwsT0FBdEIsQ0FBTjtBQUNEO0FBQ0YsT0FORCxNQU1PO0FBQ0xPLGdCQUFRQyxLQUFSLENBQWMsd0JBQWQsRUFBd0NaLFFBQVFDLElBQVIsQ0FBYUssR0FBckQ7QUFDRDtBQUNGLEtBbkNrQjs7QUFBQSxTQWdFbkJPLEdBaEVtQixHQWdF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QXBCLENBQXJELEVBQTZGO0FBQzNGLGdCQUFNLE9BQUt6RixHQUFMLENBQVUsd0JBQXVCLE9BQUtFLEVBQUwsQ0FBUXFCLEtBQVIsQ0FBY2tFLGlCQUFkLENBQWlDLEdBQWxFLENBQU47QUFDRDtBQUNGO0FBdEJnQztBQXVCbEM7O0FBRURFLGlCQUFlMUUsU0FBZixFQUEwQjtBQUN4QixRQUFJQSxVQUFVeUUsT0FBVixDQUFrQixPQUFsQixNQUErQixDQUFuQyxFQUFzQztBQUNwQyxhQUFPLElBQVA7QUFDRDs7QUFFRCxRQUFJekUsVUFBVXlFLE9BQVYsQ0FBa0IsU0FBbEIsTUFBaUMsQ0FBckMsRUFBd0M7QUFDdEMsYUFBTyxJQUFQO0FBQ0Q7O0FBRUQsV0FBTyxLQUFQO0FBQ0Q7O0FBRUtKLGlCQUFOLEdBQXdCO0FBQUE7O0FBQUE7QUFDdEIsWUFBTVIsT0FBTyxNQUFNLE9BQUs1RSxFQUFMLENBQVEyRSxHQUFSLENBQVksa0VBQVosQ0FBbkI7O0FBRUEsYUFBS1UsVUFBTCxHQUFrQlQsS0FBS2hELEdBQUwsQ0FBUztBQUFBLGVBQUtDLEVBQUVDLElBQVA7QUFBQSxPQUFULENBQWxCO0FBSHNCO0FBSXZCOztBQUVEbkIsdUJBQXFCakIsSUFBckIsRUFBMkJtQixVQUEzQixFQUF1QztBQUNyQyxXQUFPQSxhQUFjLEdBQUVuQixLQUFLb0MsSUFBSyxNQUFLakIsV0FBVzZFLFFBQVMsRUFBbkQsR0FBdURoRyxLQUFLb0MsSUFBbkU7QUFDRDtBQTVSa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZmlsZTogcGF0aC5qb2luKGZ1bGNydW0uZGlyKCdnZW9wYWNrYWdlJyksIGZ1bGNydW0uYXJncy5vcmcgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICByZXR1cm4gdGhpcy5kYi5leGVjdXRlKHNxbCk7XG4gIH1cblxuICBvbkZvcm1TYXZlID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50LCBvbGRGb3JtLCBuZXdGb3JtfSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIG9uUmVjb3Jkc0ZpbmlzaGVkID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50fSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVJlY29yZCA9IGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0ocmVjb3JkLmZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlRm9ybSA9IGFzeW5jIChmb3JtLCBhY2NvdW50KSA9PiB7XG4gICAgY29uc3QgcmF3UGF0aCA9IGZ1bGNydW0uZGF0YWJhc2VGaWxlUGF0aDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGBBVFRBQ0ggREFUQUJBU0UgJyR7cmF3UGF0aH0nIGFzICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSksIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9X3ZpZXdfZnVsbGAsIG51bGwpO1xuXG4gICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKTtcblxuICAgICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0YWJsZU5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9XyR7cmVwZWF0YWJsZS5rZXl9X3ZpZXdfZnVsbGAsIHJlcGVhdGFibGUpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKGBERVRBQ0ggREFUQUJBU0UgJ2FwcCdgKTtcblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVRhYmxlID0gYXN5bmMgKHRhYmxlTmFtZSwgc291cmNlVGFibGVOYW1lLCByZXBlYXRhYmxlKSA9PiB7XG4gICAgY29uc3QgdGVtcFRhYmxlTmFtZSA9IHNvdXJjZVRhYmxlTmFtZSArICdfdG1wJztcblxuICAgIGNvbnN0IGRyb3BUZW1wbGF0ZSA9IGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9O2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlVGVtcGxhdGVUYWJsZSA9IGBDUkVBVEUgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfSBBUyBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihjcmVhdGVUZW1wbGF0ZVRhYmxlKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RlbXBUYWJsZU5hbWV9J2ApO1xuICAgIGNvbnN0IHtjb2x1bW5zfSA9IGF3YWl0IHRoaXMuZGIuZXhlY3V0ZShgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgKTtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGUgPSByZXN1bHQuc3FsLnJlcGxhY2UodGVtcFRhYmxlTmFtZSwgdGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgnKFxcbicsICcgKF9pZCBJTlRFR0VSIFBSSU1BUlkgS0VZIEFVVE9JTkNSRU1FTlQsICcpO1xuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBjb2x1bW5zLm1hcChvID0+IHRoaXMuZGIuaWRlbnQoby5uYW1lKSk7XG5cbiAgICBsZXQgb3JkZXJCeSA9ICdPUkRFUiBCWSBfcmVjb3JkX2lkJztcblxuICAgIGlmIChyZXBlYXRhYmxlICE9IG51bGwpIHtcbiAgICAgIG9yZGVyQnkgPSAnT1JERVIgQlkgX2NoaWxkX3JlY29yZF9pZCc7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsU1FMID0gYFxuICAgICAgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9O1xuXG4gICAgICAkeyBjcmVhdGUgfTtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBBREQgX2NyZWF0ZWRfYnlfZW1haWwgVEVYVDtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBBREQgX3VwZGF0ZWRfYnlfZW1haWwgVEVYVDtcblxuICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9LCBfY3JlYXRlZF9ieV9lbWFpbCwgX3VwZGF0ZWRfYnlfZW1haWwpXG4gICAgICBTRUxFQ1QgJHtjb2x1bW5OYW1lcy5tYXAobyA9PiAndC4nICsgbykuam9pbignLCAnKX0sIG1jLmVtYWlsIEFTIF9jcmVhdGVkX2J5X2VtYWlsLCBtdS5lbWFpbCBBUyBfdXBkYXRlZF9ieV9lbWFpbFxuICAgICAgRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IHRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtYyBPTiB0Ll9jcmVhdGVkX2J5X2lkID0gbWMudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG11IE9OIHQuX3VwZGF0ZWRfYnlfaWQgPSBtdS51c2VyX3Jlc291cmNlX2lkXG4gICAgICAke29yZGVyQnl9O1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihhbGxTUUwpO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgPT0gbnVsbCkge1xuICAgICAgY29uc3QgcGFyZW50U1FMID0gYFxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9hc3NpZ25lZF90b19lbWFpbCBURVhUO1xuXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX3Byb2plY3RfbmFtZSBURVhUO1xuXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgU0VUIF9hc3NpZ25lZF90b19lbWFpbCA9IChTRUxFQ1QgZW1haWwgRlJPTSBhcHAubWVtYmVyc2hpcHMgbSBXSEVSRSBtLnVzZXJfcmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX2Fzc2lnbmVkX3RvX2lkKSxcbiAgICAgICAgX3Byb2plY3RfbmFtZSA9IChTRUxFQ1QgbmFtZSBGUk9NIGFwcC5wcm9qZWN0cyBwIFdIRVJFIHAucmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX3Byb2plY3RfaWQpO1xuICAgICAgYDtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4ocGFyZW50U1FMKTtcbiAgICB9XG5cbiAgICBjb25zdCB0YWJsZU5hbWVMaXRlcmFsID0gdGhpcy5kYi5saXRlcmFsKHRhYmxlTmFtZSk7XG5cbiAgICBjb25zdCBnZW9tU1FMID0gYFxuICAgICAgREVMRVRFIEZST00gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zIFdIRVJFIHRhYmxlX25hbWU9JHt0YWJsZU5hbWVMaXRlcmFsfTtcblxuICAgICAgSU5TRVJUIElOVE8gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zXG4gICAgICAodGFibGVfbmFtZSwgY29sdW1uX25hbWUsIGdlb21ldHJ5X3R5cGVfbmFtZSwgc3JzX2lkLCB6LCBtKVxuICAgICAgVkFMVUVTICgke3RhYmxlTmFtZUxpdGVyYWx9LCAnX2dlb20nLCAnUE9JTlQnLCA0MzI2LCAwLCAwKTtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfZ2VvbSBCTE9CO1xuXG4gICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBTRVQgX2dlb20gPSBncGtnTWFrZVBvaW50KF9sb25naXR1ZGUsIF9sYXRpdHVkZSwgNDMyNik7XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfY29udGVudHMgKHRhYmxlX25hbWUsIGRhdGFfdHlwZSwgaWRlbnRpZmllciwgc3JzX2lkKVxuICAgICAgU0VMRUNUICR7dGFibGVOYW1lTGl0ZXJhbH0sICdmZWF0dXJlcycsICR7dGFibGVOYW1lTGl0ZXJhbH0sIDQzMjZcbiAgICAgIFdIRVJFIE5PVCBFWElTVFMgKFNFTEVDVCAxIEZST00gZ3BrZ19jb250ZW50cyBXSEVSRSB0YWJsZV9uYW1lID0gJHt0YWJsZU5hbWVMaXRlcmFsfSk7XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGdlb21TUUwpO1xuICB9XG5cbiAgYXN5bmMgZW5hYmxlU3BhdGlhTGl0ZShkYikge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBzcGF0aWFsaXRlUGF0aCA9IG51bGw7XG5cbiAgICAgIC8vIHRoZSBkaWZmZXJlbnQgcGxhdGZvcm1zIGFuZCBjb25maWd1cmF0aW9ucyByZXF1aXJlIHZhcmlvdXMgZGlmZmVyZW50IGxvYWQgcGF0aHMgZm9yIHRoZSBzaGFyZWQgbGlicmFyeVxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEU7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MuZW52LkRFVkVMT1BNRU5UKSB7XG4gICAgICAgIGxldCBwbGF0Zm9ybSA9ICdsaW51eCc7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICd3aW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnbWFjJztcbiAgICAgICAgfVxuXG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKCcuJywgJ3Jlc291cmNlcycsICdzcGF0aWFsaXRlJywgcGxhdGZvcm0sIHByb2Nlc3MuYXJjaCwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uJywgJ1Jlc291cmNlcycsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gJ21vZF9zcGF0aWFsaXRlJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRiLmRhdGFiYXNlLmxvYWRFeHRlbnNpb24oc3BhdGlhbGl0ZVBhdGgsIChlcnIpID0+IGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNoZWNrID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBDaGVja0dlb1BhY2thZ2VNZXRhRGF0YSgpIEFTIHJlc3VsdCcpO1xuXG4gICAgaWYgKGNoZWNrWzBdLnJlc3VsdCAhPT0gMSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgZ3BrZ0NyZWF0ZUJhc2VUYWJsZXMoKScpO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIEVuYWJsZUdwa2dNb2RlKCkgQVMgZW5hYmxlZCwgR2V0R3BrZ01vZGUoKSBBUyBtb2RlJyk7XG5cbiAgICBpZiAobW9kZVswXS5tb2RlICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgdmVyaWZ5aW5nIHRoZSBHUEtHIG1vZGUnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBydW5TUUwoc3FsKSB7XG4gICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5hbGwoc3FsKTtcbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmVzdWx0ID0ge2Vycm9yOiBleC5tZXNzYWdlfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgfVxuXG4gIGFzeW5jIGNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCkge1xuICAgIGF3YWl0IHRoaXMucmVsb2FkVGFibGVMaXN0KCk7XG5cbiAgICBjb25zdCB0YWJsZU5hbWVzID0gW107XG5cbiAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgdGFibGVOYW1lcy5wdXNoKHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSkpO1xuXG4gICAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgICAgdGFibGVOYW1lcy5wdXNoKHRhYmxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gZmluZCBhbnkgdGFibGVzIHRoYXQgc2hvdWxkIGJlIGRyb3BwZWQgYmVjYXVzZSB0aGV5IGdvdCByZW5hbWVkXG4gICAgZm9yIChjb25zdCBleGlzdGluZ1RhYmxlTmFtZSBvZiB0aGlzLnRhYmxlTmFtZXMpIHtcbiAgICAgIGlmICh0YWJsZU5hbWVzLmluZGV4T2YoZXhpc3RpbmdUYWJsZU5hbWUpID09PSAtMSAmJiAhdGhpcy5pc1NwZWNpYWxUYWJsZShleGlzdGluZ1RhYmxlTmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW4oYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudChleGlzdGluZ1RhYmxlTmFtZSl9O2ApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlzU3BlY2lhbFRhYmxlKHRhYmxlTmFtZSkge1xuICAgIGlmICh0YWJsZU5hbWUuaW5kZXhPZignZ3BrZ18nKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgaWYgKHRhYmxlTmFtZS5pbmRleE9mKCdzcWxpdGVfJykgPT09IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHJlbG9hZFRhYmxlTGlzdCgpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoXCJTRUxFQ1QgdGJsX25hbWUgQVMgbmFtZSBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdHlwZSA9ICd0YWJsZSc7XCIpO1xuXG4gICAgdGhpcy50YWJsZU5hbWVzID0gcm93cy5tYXAobyA9PiBvLm5hbWUpO1xuICB9XG5cbiAgZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSkge1xuICAgIHJldHVybiByZXBlYXRhYmxlID8gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gIDogZm9ybS5uYW1lO1xuICB9XG59XG4iXX0=