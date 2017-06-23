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
    const name = repeatable ? `${form.name} - ${repeatable.dataName}` : form.name;

    return fulcrum.args.gpkgUnderscoreNames ? (0, _snakeCase2.default)(name) : name;
  }
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJkcm9wIiwiZ3BrZ0Ryb3AiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImluY2x1ZGVVc2VySW5mbyIsImdwa2dVc2VySW5mbyIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJuYW1lIiwib3JkZXJCeSIsImV4aXN0aW5nVGFibGUiLCJ1c2VySW5mbyIsInB1c2giLCJqb2luIiwiaW5jbHVkZUpvaW5lZE5hbWVzIiwiZ3BrZ0pvaW5lZE5hbWVzIiwidGFibGVOYW1lTGl0ZXJhbCIsImxpdGVyYWwiLCJnZW9tU1FMIiwidGFzayIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwidHlwZSIsImdwa2dOYW1lIiwiZ3BrZ1BhdGgiLCJkZWZhdWx0IiwiZ3BrZ1VuZGVyc2NvcmVOYW1lcyIsImhhbmRsZXIiLCJkZWZhdWx0RGF0YWJhc2VPcHRpb25zIiwid2FsIiwiYXV0b1ZhY3V1bSIsInN5bmNocm9ub3VzIiwibWtkaXJwIiwiZGF0YWJhc2VOYW1lIiwiZGF0YWJhc2VEaXJlY3RvcnkiLCJkaXIiLCJvcHRpb25zIiwiZmlsZSIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwib24iLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5IiwicmVsb2FkVGFibGVMaXN0IiwidGFibGVOYW1lcyIsImV4aXN0aW5nVGFibGVOYW1lIiwiaW5kZXhPZiIsImlzU3BlY2lhbFRhYmxlIiwiZGF0YU5hbWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7QUFDQTs7Ozs7Ozs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0FrRG5CQSxVQWxEbUIscUJBa0ROLGFBQVk7QUFDdkIsWUFBTSxNQUFLQyxRQUFMLEVBQU47O0FBRUEsVUFBSUMsUUFBUUMsSUFBUixDQUFhQyxHQUFqQixFQUFzQjtBQUNwQixjQUFNLE1BQUtDLE1BQUwsQ0FBWUgsUUFBUUMsSUFBUixDQUFhQyxHQUF6QixDQUFOO0FBQ0E7QUFDRDs7QUFFRCxZQUFNRSxVQUFVLE1BQU1KLFFBQVFLLFlBQVIsQ0FBcUJMLFFBQVFDLElBQVIsQ0FBYUssR0FBbEMsQ0FBdEI7O0FBRUEsVUFBSUYsT0FBSixFQUFhO0FBQ1gsY0FBTUcsUUFBUSxNQUFNSCxRQUFRSSxlQUFSLENBQXdCLEVBQXhCLENBQXBCOztBQUVBLGFBQUssTUFBTUMsSUFBWCxJ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UUFBUyxFQUFuRCxHQUF1RDVHLEtBQUt3QyxJQUF6RTs7QUFFQSxXQUFPakQsUUFBUUMsSUFBUixDQUFhcUUsbUJBQWIsR0FBbUMseUJBQU1yQixJQUFOLENBQW5DLEdBQWlEQSxJQUF4RDtBQUNEO0FBaldrQixDIiwiZmlsZSI6InBsdWdpbi5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgU1FMaXRlIH0gZnJvbSAnZnVsY3J1bSc7XG5pbXBvcnQgc25ha2UgZnJvbSAnc25ha2UtY2FzZSc7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIHtcbiAgYXN5bmMgdGFzayhjbGkpIHtcbiAgICByZXR1cm4gY2xpLmNvbW1hbmQoe1xuICAgICAgY29tbWFuZDogJ2dlb3BhY2thZ2UnLFxuICAgICAgZGVzYzogJ2NyZWF0ZSBhIGdlb3BhY2thZ2UgZGF0YWJhc2UgZm9yIGFuIG9yZ2FuaXphdGlvbicsXG4gICAgICBidWlsZGVyOiB7XG4gICAgICAgIG9yZzoge1xuICAgICAgICAgIGRlc2M6ICdvcmdhbml6YXRpb24gbmFtZScsXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ05hbWU6IHtcbiAgICAgICAgICBkZXNjOiAnZGF0YWJhc2UgbmFtZScsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dQYXRoOiB7XG4gICAgICAgICAgZGVzYzogJ2RhdGFiYXNlIGRpcmVjdG9yeScsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dEcm9wOiB7XG4gICAgICAgICAgZGVzYzogJ2Ryb3AgdGFibGVzIGZpcnN0JyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ1VuZGVyc2NvcmVOYW1lczoge1xuICAgICAgICAgIGRlc2M6ICd1c2UgdW5kZXJzY29yZSBuYW1lcyAoZS5nLiBcIlBhcmsgSW5zcGVjdGlvbnNcIiBiZWNvbWVzIFwicGFya19pbnNwZWN0aW9uc1wiKScsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiBmYWxzZVxuICAgICAgICB9LFxuICAgICAgICBncGtnVXNlckluZm86IHtcbiAgICAgICAgICBkZXNjOiAnaW5jbHVkZSB1c2VyIGluZm8nLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBncGtnSm9pbmVkTmFtZXM6IHtcbiAgICAgICAgICBkZXNjOiAnaW5jbHVkZSBwcm9qZWN0IG5hbWUgYW5kIGFzc2lnbm1lbnQgZW1haWwgb24gcmVjb3JkIHRhYmxlcycsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBkYXRhYmFzZU5hbWUgPSBmdWxjcnVtLmFyZ3MuZ3BrZ05hbWUgfHwgZnVsY3J1bS5hcmdzLm9yZztcbiAgICBjb25zdCBkYXRhYmFzZURpcmVjdG9yeSA9IGZ1bGNydW0uYXJncy5ncGtnUGF0aCB8fCBmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihkYXRhYmFzZURpcmVjdG9yeSwgZGF0YWJhc2VOYW1lICsgJy5ncGtnJylcbiAgICB9O1xuXG4gICAgdGhpcy5kYiA9IGF3YWl0IFNRTGl0ZS5vcGVuKHsuLi5kZWZhdWx0RGF0YWJhc2VPcHRpb25zLCAuLi5vcHRpb25zfSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuYWJsZVNwYXRpYUxpdGUodGhpcy5kYik7XG5cbiAgICBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICAgIGlmICh0aGlzLmRiKSB7XG4gICAgICBhd2FpdCB0aGlzLmRiLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgcnVuID0gKHNxbCkgPT4ge1xuICAgIHNxbCA9IHNxbC5yZXBsYWNlKC9cXDAvZywgJycpO1xuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV92aWV3X2Z1bGxgLCBudWxsKTtcblxuICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG5cbiAgICBjb25zdCBkcm9wID0gZnVsY3J1bS5hcmdzLmdwa2dEcm9wICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZ3BrZ0Ryb3AgOiB0cnVlO1xuXG4gICAgaWYgKGRyb3ApIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KTtcbiAgICB9XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBjb25zdCBpbmNsdWRlVXNlckluZm8gPSBmdWxjcnVtLmFyZ3MuZ3BrZ1VzZXJJbmZvICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZ3BrZ1VzZXJJbmZvIDogdHJ1ZTtcblxuICAgIGxldCBkcm9wID0gZnVsY3J1bS5hcmdzLmdwa2dEcm9wICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZ3BrZ0Ryb3AgOiB0cnVlO1xuXG4gICAgY29uc3QgZHJvcFRlbXBsYXRlID0gYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX07YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZVRhYmxlID0gYENSRUFURSBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9IEFTIFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGNyZWF0ZVRlbXBsYXRlVGFibGUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGVtcFRhYmxlTmFtZX0nYCk7XG4gICAgY29uc3Qge2NvbHVtbnN9ID0gYXdhaXQgdGhpcy5kYi5leGVjdXRlKGBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2ApO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZSA9IHJlc3VsdC5zcWwucmVwbGFjZSh0ZW1wVGFibGVOYW1lLCB0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKCcoXFxuJywgJyAoX2lkIElOVEVHRVIgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyk7XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGNvbHVtbnMubWFwKG8gPT4gdGhpcy5kYi5pZGVudChvLm5hbWUpKTtcblxuICAgIGxldCBvcmRlckJ5ID0gJ09SREVSIEJZIF9yZWNvcmRfaWQnO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgIT0gbnVsbCkge1xuICAgICAgb3JkZXJCeSA9ICdPUkRFUiBCWSBfY2hpbGRfcmVjb3JkX2lkJztcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1RhYmxlID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGFibGVOYW1lfSdgKTtcblxuICAgIGxldCBzcWwgPSBbXTtcblxuICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICBsZXQgdXNlckluZm8gPSAnJztcblxuICAgICAgaWYgKGluY2x1ZGVVc2VySW5mbykge1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgfVxuXG4gICAgICBzcWwucHVzaChgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9O2ApO1xuXG4gICAgICBzcWwucHVzaChjcmVhdGUgKyAnOycpO1xuICAgIH1cblxuICAgIGlmIChpbmNsdWRlVXNlckluZm8pIHtcbiAgICAgIHNxbC5wdXNoKGBcbiAgICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9LCBfY3JlYXRlZF9ieV9lbWFpbCwgX3VwZGF0ZWRfYnlfZW1haWwpXG4gICAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfSwgbWMuZW1haWwgQVMgX2NyZWF0ZWRfYnlfZW1haWwsIG11LmVtYWlsIEFTIF91cGRhdGVkX2J5X2VtYWlsXG4gICAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtYyBPTiB0Ll9jcmVhdGVkX2J5X2lkID0gbWMudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbXUgT04gdC5fdXBkYXRlZF9ieV9pZCA9IG11LnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICAgJHtvcmRlckJ5fTtcbiAgICAgIGApO1xuICAgIH0gZWxzZSB7XG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSlcbiAgICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9XG4gICAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICAgICR7b3JkZXJCeX07XG4gICAgICBgKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihzcWwuam9pbignXFxuJykpO1xuXG4gICAgc3FsID0gW107XG5cbiAgICBjb25zdCBpbmNsdWRlSm9pbmVkTmFtZXMgPSBmdWxjcnVtLmFyZ3MuZ3BrZ0pvaW5lZE5hbWVzICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZ3BrZ0pvaW5lZE5hbWVzIDogdHJ1ZTtcblxuICAgIGlmIChyZXBlYXRhYmxlID09IG51bGwgJiYgaW5jbHVkZUpvaW5lZE5hbWVzKSB7XG4gICAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfYXNzaWduZWRfdG9fZW1haWwgVEVYVDtgKTtcbiAgICAgICAgc3FsLnB1c2goYEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX3Byb2plY3RfbmFtZSBURVhUO2ApO1xuICAgICAgfVxuXG5cbiAgICAgIHNxbC5wdXNoKGBcbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBTRVQgX2Fzc2lnbmVkX3RvX2VtYWlsID0gKFNFTEVDVCBlbWFpbCBGUk9NIGFwcC5tZW1iZXJzaGlwcyBtIFdIRVJFIG0udXNlcl9yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fYXNzaWduZWRfdG9faWQpLFxuICAgICAgICBfcHJvamVjdF9uYW1lID0gKFNFTEVDVCBuYW1lIEZST00gYXBwLnByb2plY3RzIHAgV0hFUkUgcC5yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fcHJvamVjdF9pZCk7XG4gICAgICBgKTtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4oc3FsLmpvaW4oJ1xcbicpKTtcbiAgICB9XG5cbiAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lTGl0ZXJhbCA9IHRoaXMuZGIubGl0ZXJhbCh0YWJsZU5hbWUpO1xuXG4gICAgICBjb25zdCBnZW9tU1FMID0gYFxuICAgICAgICBERUxFVEUgRlJPTSBncGtnX2dlb21ldHJ5X2NvbHVtbnMgV0hFUkUgdGFibGVfbmFtZT0ke3RhYmxlTmFtZUxpdGVyYWx9O1xuXG4gICAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgICAodGFibGVfbmFtZSwgY29sdW1uX25hbWUsIGdlb21ldHJ5X3R5cGVfbmFtZSwgc3JzX2lkLCB6LCBtKVxuICAgICAgICBWQUxVRVMgKCR7dGFibGVOYW1lTGl0ZXJhbH0sICdfZ2VvbScsICdQT0lOVCcsIDQzMjYsIDAsIDApO1xuXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgICAgU0VMRUNUICR7dGFibGVOYW1lTGl0ZXJhbH0sICdmZWF0dXJlcycsICR7dGFibGVOYW1lTGl0ZXJhbH0sIDQzMjZcbiAgICAgICAgV0hFUkUgTk9UIEVYSVNUUyAoU0VMRUNUIDEgRlJPTSBncGtnX2NvbnRlbnRzIFdIRVJFIHRhYmxlX25hbWUgPSAke3RhYmxlTmFtZUxpdGVyYWx9KTtcbiAgICAgIGA7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKGdlb21TUUwpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKGBcbiAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIFNFVCBfZ2VvbSA9IGdwa2dNYWtlUG9pbnQoX2xvbmdpdHVkZSwgX2xhdGl0dWRlLCA0MzI2KTtcbiAgICBgKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBsZXQgcGxhdGZvcm0gPSAnbGludXgnO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnd2luJztcbiAgICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ21hYyc7XG4gICAgICAgIH1cblxuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsIHBsYXRmb3JtLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cblxuICBhc3luYyBjbGVhbnVwVGFibGVzKGZvcm0sIGFjY291bnQpIHtcbiAgICBhd2FpdCB0aGlzLnJlbG9hZFRhYmxlTGlzdCgpO1xuXG4gICAgY29uc3QgdGFibGVOYW1lcyA9IFtdO1xuXG4gICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgIHRhYmxlTmFtZXMucHVzaCh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pKTtcblxuICAgICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpO1xuXG4gICAgICAgIHRhYmxlTmFtZXMucHVzaCh0YWJsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGZpbmQgYW55IHRhYmxlcyB0aGF0IHNob3VsZCBiZSBkcm9wcGVkIGJlY2F1c2UgdGhleSBnb3QgcmVuYW1lZFxuICAgIGZvciAoY29uc3QgZXhpc3RpbmdUYWJsZU5hbWUgb2YgdGhpcy50YWJsZU5hbWVzKSB7XG4gICAgICBpZiAodGFibGVOYW1lcy5pbmRleE9mKGV4aXN0aW5nVGFibGVOYW1lKSA9PT0gLTEgJiYgIXRoaXMuaXNTcGVjaWFsVGFibGUoZXhpc3RpbmdUYWJsZU5hbWUpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuKGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQoZXhpc3RpbmdUYWJsZU5hbWUpfTtgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpc1NwZWNpYWxUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBpZiAodGFibGVOYW1lLmluZGV4T2YoJ2dwa2dfJykgPT09IDAgfHxcbiAgICAgICAgICB0YWJsZU5hbWUuaW5kZXhPZignc3FsaXRlXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ2N1c3RvbV8nKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcmVsb2FkVGFibGVMaXN0KCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbChcIlNFTEVDVCB0YmxfbmFtZSBBUyBuYW1lIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0eXBlID0gJ3RhYmxlJztcIik7XG5cbiAgICB0aGlzLnRhYmxlTmFtZXMgPSByb3dzLm1hcChvID0+IG8ubmFtZSk7XG4gIH1cblxuICBnZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKSB7XG4gICAgY29uc3QgbmFtZSA9IHJlcGVhdGFibGUgPyBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWAgOiBmb3JtLm5hbWU7XG5cbiAgICByZXR1cm4gZnVsY3J1bS5hcmdzLmdwa2dVbmRlcnNjb3JlTmFtZXMgPyBzbmFrZShuYW1lKSA6IG5hbWU7XG4gIH1cbn1cbiJdfQ==