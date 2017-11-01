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

      yield _this.run('VACUUM');
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

        const includeFormattedDates = fulcrum.args.includeFormattedDates != null ? fulcrum.args.includeFormattedDates : true;

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

          sql.push(`DROP TABLE IF EXISTS main.${_this.db.ident(tableName)};`);

          sql.push(create + ';');

          if (includeUserInfo) {
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _created_by_email TEXT;`);
            sql.push(`ALTER TABLE ${_this.db.ident(tableName)} ADD _updated_by_email TEXT;`);
          }
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

        if (includeFormattedDates) {
          sql.push(`
        UPDATE ${_this.db.ident(tableName)} SET _created_at = strftime('%Y-%m-%d %H:%M:%S', _created_at / 1000, 'unixepoch');
        UPDATE ${_this.db.ident(tableName)} SET _updated_at = strftime('%Y-%m-%d %H:%M:%S', _updated_at / 1000, 'unixepoch');
        UPDATE ${_this.db.ident(tableName)} SET _server_created_at = strftime('%Y-%m-%d %H:%M:%S', _server_created_at / 1000, 'unixepoch');
        UPDATE ${_this.db.ident(tableName)} SET _server_updated_at = strftime('%Y-%m-%d %H:%M:%S', _server_updated_at / 1000, 'unixepoch');
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
          },
          includeFormattedDates: {
            desc: 'format dates from unixepoch to YYYY-MM-DD HH:MM:SS',
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRlYnVnIiwibG9nIiwiZGIiLCJleGVjdXRlIiwib25Gb3JtU2F2ZSIsIm9sZEZvcm0iLCJuZXdGb3JtIiwib25SZWNvcmRzRmluaXNoZWQiLCJ1cGRhdGVSZWNvcmQiLCJyZWNvcmQiLCJyYXdQYXRoIiwiZGF0YWJhc2VGaWxlUGF0aCIsInVwZGF0ZVRhYmxlIiwiZ2V0RnJpZW5kbHlUYWJsZU5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImtleSIsImRyb3AiLCJncGtnRHJvcCIsImNsZWFudXBUYWJsZXMiLCJzb3VyY2VUYWJsZU5hbWUiLCJ0ZW1wVGFibGVOYW1lIiwiaW5jbHVkZUZvcm1hdHRlZERhdGVzIiwiaW5jbHVkZVVzZXJJbmZvIiwiZ3BrZ1VzZXJJbmZvIiwiZHJvcFRlbXBsYXRlIiwiaWRlbnQiLCJjcmVhdGVUZW1wbGF0ZVRhYmxlIiwicmVzdWx0IiwiZ2V0IiwiY29sdW1ucyIsImNyZWF0ZSIsImNvbHVtbk5hbWVzIiwibWFwIiwibyIsIm5hbWUiLCJvcmRlckJ5IiwiZXhpc3RpbmdUYWJsZSIsInVzZXJJbmZvIiwicHVzaCIsImpvaW4iLCJpbmNsdWRlSm9pbmVkTmFtZXMiLCJncGtnSm9pbmVkTmFtZXMiLCJ0YWJsZU5hbWVMaXRlcmFsIiwibGl0ZXJhbCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiZ3BrZ05hbWUiLCJncGtnUGF0aCIsImRlZmF1bHQiLCJncGtnVW5kZXJzY29yZU5hbWVzIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJkYXRhYmFzZU5hbWUiLCJkYXRhYmFzZURpcmVjdG9yeSIsImRpciIsIm9wdGlvbnMiLCJmaWxlIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJKU09OIiwic3RyaW5naWZ5IiwicmVsb2FkVGFibGVMaXN0IiwidGFibGVOYW1lcyIsImV4aXN0aW5nVGFibGVOYW1lIiwiaW5kZXhPZiIsImlzU3BlY2lhbFRhYmxlIiwiZGF0YU5hbWUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7QUFDQTs7Ozs7Ozs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0F3RG5CQSxVQXhEbUIscUJBd0ROLGFBQVk7QUFDdkIsWUFBTSxNQUFLQyxRQUFMLEVBQU47O0FBRUEsVUFBSUMsUUFBUUMsSUFBUixDQUFhQyxHQUFqQixFQUFzQjtBQUNwQixjQUFNLE1BQUtDLE1BQUwsQ0FBWUgsUUFBUUMsSUFBUixDQUFhQyxHQUF6QixDQUFOO0FBQ0E7QUFDRDs7QUFFRCxZQUFNRSxVQUFVLE1BQU1KLFFBQVFLLFlBQVIsQ0FBcUJMLFFBQVFDLElBQVIsQ0FBYUssR0FBbEMsQ0FBdEI7O0FBRUEsVUFBSUYsT0FBSixFQUFhO0FBQ1gsY0FBTUcsUUFBUSxNQUFNSCxRQUFRSSxlQUFSLENBQXdCLEVBQXhCLENB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dEJnQztBQXVCbEM7O0FBRURFLGlCQUFlckYsU0FBZixFQUEwQjtBQUN4QixRQUFJQSxVQUFVb0YsT0FBVixDQUFrQixPQUFsQixNQUErQixDQUEvQixJQUNFcEYsVUFBVW9GLE9BQVYsQ0FBa0IsU0FBbEIsTUFBaUMsQ0FEbkMsSUFFRXBGLFVBQVVvRixPQUFWLENBQWtCLFNBQWxCLE1BQWlDLENBRnZDLEVBRTBDO0FBQ3hDLGFBQU8sSUFBUDtBQUNEOztBQUVELFdBQU8sS0FBUDtBQUNEOztBQUVLSCxpQkFBTixHQUF3QjtBQUFBOztBQUFBO0FBQ3RCLFlBQU1QLE9BQU8sTUFBTSxPQUFLekYsRUFBTCxDQUFRd0YsR0FBUixDQUFZLGtFQUFaLENBQW5COztBQUVBLGFBQUtTLFVBQUwsR0FBa0JSLEtBQUt4RCxHQUFMLENBQVM7QUFBQSxlQUFLQyxFQUFFQyxJQUFQO0FBQUEsT0FBVCxDQUFsQjtBQUhzQjtBQUl2Qjs7QUFFRHhCLHVCQUFxQm5CLElBQXJCLEVBQTJCcUIsVUFBM0IsRUFBdUM7QUFDckMsVUFBTXNCLE9BQU90QixhQUFjLEdBQUVyQixLQUFLMkMsSUFBSyxNQUFLdEIsV0FBV3dGLFFBQVMsRUFBbkQsR0FBdUQ3RyxLQUFLMkMsSUFBekU7O0FBRUEsV0FBT3BELFFBQVFDLElBQVIsQ0FBYXdFLG1CQUFiLEdBQW1DLHlCQUFNckIsSUFBTixDQUFuQyxHQUFpREEsSUFBeEQ7QUFDRDtBQXhYa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuaW1wb3J0IHNuYWtlIGZyb20gJ3NuYWtlLWNhc2UnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dOYW1lOiB7XG4gICAgICAgICAgZGVzYzogJ2RhdGFiYXNlIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnUGF0aDoge1xuICAgICAgICAgIGRlc2M6ICdkYXRhYmFzZSBkaXJlY3RvcnknLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBncGtnRHJvcDoge1xuICAgICAgICAgIGRlc2M6ICdkcm9wIHRhYmxlcyBmaXJzdCcsXG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIHR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2dVbmRlcnNjb3JlTmFtZXM6IHtcbiAgICAgICAgICBkZXNjOiAndXNlIHVuZGVyc2NvcmUgbmFtZXMgKGUuZy4gXCJQYXJrIEluc3BlY3Rpb25zXCIgYmVjb21lcyBcInBhcmtfaW5zcGVjdGlvbnNcIiknLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogZmFsc2VcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ1VzZXJJbmZvOiB7XG4gICAgICAgICAgZGVzYzogJ2luY2x1ZGUgdXNlciBpbmZvJyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgZ3BrZ0pvaW5lZE5hbWVzOiB7XG4gICAgICAgICAgZGVzYzogJ2luY2x1ZGUgcHJvamVjdCBuYW1lIGFuZCBhc3NpZ25tZW50IGVtYWlsIG9uIHJlY29yZCB0YWJsZXMnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICB9LFxuICAgICAgICBpbmNsdWRlRm9ybWF0dGVkRGF0ZXM6IHtcbiAgICAgICAgICBkZXNjOiAnZm9ybWF0IGRhdGVzIGZyb20gdW5peGVwb2NoIHRvIFlZWVktTU0tREQgSEg6TU06U1MnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3Muc3FsKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blNRTChmdWxjcnVtLmFyZ3Muc3FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bignVkFDVVVNJyk7XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICBjb25zdCBkZWZhdWx0RGF0YWJhc2VPcHRpb25zID0ge1xuICAgICAgd2FsOiB0cnVlLFxuICAgICAgYXV0b1ZhY3V1bTogdHJ1ZSxcbiAgICAgIHN5bmNocm9ub3VzOiAnb2ZmJ1xuICAgIH07XG5cbiAgICBmdWxjcnVtLm1rZGlycCgnZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3QgZGF0YWJhc2VOYW1lID0gZnVsY3J1bS5hcmdzLmdwa2dOYW1lIHx8IGZ1bGNydW0uYXJncy5vcmc7XG4gICAgY29uc3QgZGF0YWJhc2VEaXJlY3RvcnkgPSBmdWxjcnVtLmFyZ3MuZ3BrZ1BhdGggfHwgZnVsY3J1bS5kaXIoJ2dlb3BhY2thZ2UnKTtcblxuICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICBmaWxlOiBwYXRoLmpvaW4oZGF0YWJhc2VEaXJlY3RvcnksIGRhdGFiYXNlTmFtZSArICcuZ3BrZycpXG4gICAgfTtcblxuICAgIHRoaXMuZGIgPSBhd2FpdCBTUUxpdGUub3Blbih7Li4uZGVmYXVsdERhdGFiYXNlT3B0aW9ucywgLi4ub3B0aW9uc30pO1xuXG4gICAgYXdhaXQgdGhpcy5lbmFibGVTcGF0aWFMaXRlKHRoaXMuZGIpO1xuXG4gICAgLy8gZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICAvLyBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgICBpZiAodGhpcy5kYikge1xuICAgICAgYXdhaXQgdGhpcy5kYi5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIHJ1biA9IChzcWwpID0+IHtcbiAgICBzcWwgPSBzcWwucmVwbGFjZSgvXFwwL2csICcnKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3MuZGVidWcpIHtcbiAgICAgIGNvbnNvbGUubG9nKHNxbCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0aGlzLmdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0pLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV92aWV3X2Z1bGxgLCBudWxsKTtcblxuICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG5cbiAgICBjb25zdCBkcm9wID0gZnVsY3J1bS5hcmdzLmdwa2dEcm9wICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuZ3BrZ0Ryb3AgOiB0cnVlO1xuXG4gICAgaWYgKGRyb3ApIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KTtcbiAgICB9XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBjb25zdCBpbmNsdWRlRm9ybWF0dGVkRGF0ZXMgPSBmdWxjcnVtLmFyZ3MuaW5jbHVkZUZvcm1hdHRlZERhdGVzICE9IG51bGwgPyBmdWxjcnVtLmFyZ3MuaW5jbHVkZUZvcm1hdHRlZERhdGVzIDogdHJ1ZTtcblxuICAgIGNvbnN0IGluY2x1ZGVVc2VySW5mbyA9IGZ1bGNydW0uYXJncy5ncGtnVXNlckluZm8gIT0gbnVsbCA/IGZ1bGNydW0uYXJncy5ncGtnVXNlckluZm8gOiB0cnVlO1xuXG4gICAgbGV0IGRyb3AgPSBmdWxjcnVtLmFyZ3MuZ3BrZ0Ryb3AgIT0gbnVsbCA/IGZ1bGNydW0uYXJncy5ncGtnRHJvcCA6IHRydWU7XG5cbiAgICBjb25zdCBkcm9wVGVtcGxhdGUgPSBgRFJPUCBUQUJMRSBJRiBFWElTVFMgbWFpbi4ke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9O2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlVGVtcGxhdGVUYWJsZSA9IGBDUkVBVEUgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfSBBUyBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihjcmVhdGVUZW1wbGF0ZVRhYmxlKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RlbXBUYWJsZU5hbWV9J2ApO1xuICAgIGNvbnN0IHtjb2x1bW5zfSA9IGF3YWl0IHRoaXMuZGIuZXhlY3V0ZShgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgKTtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGUgPSByZXN1bHQuc3FsLnJlcGxhY2UodGVtcFRhYmxlTmFtZSwgdGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgnKFxcbicsICcgKF9pZCBJTlRFR0VSIFBSSU1BUlkgS0VZIEFVVE9JTkNSRU1FTlQsICcpO1xuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBjb2x1bW5zLm1hcChvID0+IHRoaXMuZGIuaWRlbnQoby5uYW1lKSk7XG5cbiAgICBsZXQgb3JkZXJCeSA9ICdPUkRFUiBCWSBfcmVjb3JkX2lkJztcblxuICAgIGlmIChyZXBlYXRhYmxlICE9IG51bGwpIHtcbiAgICAgIG9yZGVyQnkgPSAnT1JERVIgQlkgX2NoaWxkX3JlY29yZF9pZCc7XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdUYWJsZSA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RhYmxlTmFtZX0nYCk7XG5cbiAgICBsZXQgc3FsID0gW107XG5cbiAgICBpZiAoZHJvcCB8fCAhZXhpc3RpbmdUYWJsZSkge1xuICAgICAgbGV0IHVzZXJJbmZvID0gJyc7XG5cbiAgICAgIHNxbC5wdXNoKGBEUk9QIFRBQkxFIElGIEVYSVNUUyBtYWluLiR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtgKTtcblxuICAgICAgc3FsLnB1c2goY3JlYXRlICsgJzsnKTtcblxuICAgICAgaWYgKGluY2x1ZGVVc2VySW5mbykge1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgICBzcWwucHVzaChgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO2ApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChpbmNsdWRlVXNlckluZm8pIHtcbiAgICAgIHNxbC5wdXNoKGBcbiAgICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9LCBfY3JlYXRlZF9ieV9lbWFpbCwgX3VwZGF0ZWRfYnlfZW1haWwpXG4gICAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfSwgbWMuZW1haWwgQVMgX2NyZWF0ZWRfYnlfZW1haWwsIG11LmVtYWlsIEFTIF91cGRhdGVkX2J5X2VtYWlsXG4gICAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtYyBPTiB0Ll9jcmVhdGVkX2J5X2lkID0gbWMudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbXUgT04gdC5fdXBkYXRlZF9ieV9pZCA9IG11LnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICAgJHtvcmRlckJ5fTtcbiAgICAgIGApO1xuICAgIH0gZWxzZSB7XG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSlcbiAgICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9XG4gICAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICAgICR7b3JkZXJCeX07XG4gICAgICBgKTtcbiAgICB9XG5cbiAgICBpZiAoaW5jbHVkZUZvcm1hdHRlZERhdGVzKSB7XG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gU0VUIF9jcmVhdGVkX2F0ID0gc3RyZnRpbWUoJyVZLSVtLSVkICVIOiVNOiVTJywgX2NyZWF0ZWRfYXQgLyAxMDAwLCAndW5peGVwb2NoJyk7XG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gU0VUIF91cGRhdGVkX2F0ID0gc3RyZnRpbWUoJyVZLSVtLSVkICVIOiVNOiVTJywgX3VwZGF0ZWRfYXQgLyAxMDAwLCAndW5peGVwb2NoJyk7XG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gU0VUIF9zZXJ2ZXJfY3JlYXRlZF9hdCA9IHN0cmZ0aW1lKCclWS0lbS0lZCAlSDolTTolUycsIF9zZXJ2ZXJfY3JlYXRlZF9hdCAvIDEwMDAsICd1bml4ZXBvY2gnKTtcbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBTRVQgX3NlcnZlcl91cGRhdGVkX2F0ID0gc3RyZnRpbWUoJyVZLSVtLSVkICVIOiVNOiVTJywgX3NlcnZlcl91cGRhdGVkX2F0IC8gMTAwMCwgJ3VuaXhlcG9jaCcpO1xuICAgICAgYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oc3FsLmpvaW4oJ1xcbicpKTtcblxuICAgIHNxbCA9IFtdO1xuXG4gICAgY29uc3QgaW5jbHVkZUpvaW5lZE5hbWVzID0gZnVsY3J1bS5hcmdzLmdwa2dKb2luZWROYW1lcyAhPSBudWxsID8gZnVsY3J1bS5hcmdzLmdwa2dKb2luZWROYW1lcyA6IHRydWU7XG5cbiAgICBpZiAocmVwZWF0YWJsZSA9PSBudWxsICYmIGluY2x1ZGVKb2luZWROYW1lcykge1xuICAgICAgaWYgKGRyb3AgfHwgIWV4aXN0aW5nVGFibGUpIHtcbiAgICAgICAgc3FsLnB1c2goYEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2Fzc2lnbmVkX3RvX2VtYWlsIFRFWFQ7YCk7XG4gICAgICAgIHNxbC5wdXNoKGBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9wcm9qZWN0X25hbWUgVEVYVDtgKTtcbiAgICAgIH1cblxuXG4gICAgICBzcWwucHVzaChgXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgU0VUIF9hc3NpZ25lZF90b19lbWFpbCA9IChTRUxFQ1QgZW1haWwgRlJPTSBhcHAubWVtYmVyc2hpcHMgbSBXSEVSRSBtLnVzZXJfcmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX2Fzc2lnbmVkX3RvX2lkKSxcbiAgICAgICAgX3Byb2plY3RfbmFtZSA9IChTRUxFQ1QgbmFtZSBGUk9NIGFwcC5wcm9qZWN0cyBwIFdIRVJFIHAucmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX3Byb2plY3RfaWQpO1xuICAgICAgYCk7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKHNxbC5qb2luKCdcXG4nKSk7XG4gICAgfVxuXG4gICAgaWYgKGRyb3AgfHwgIWV4aXN0aW5nVGFibGUpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZUxpdGVyYWwgPSB0aGlzLmRiLmxpdGVyYWwodGFibGVOYW1lKTtcblxuICAgICAgY29uc3QgZ2VvbVNRTCA9IGBcbiAgICAgICAgREVMRVRFIEZST00gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zIFdIRVJFIHRhYmxlX25hbWU9JHt0YWJsZU5hbWVMaXRlcmFsfTtcblxuICAgICAgICBJTlNFUlQgSU5UTyBncGtnX2dlb21ldHJ5X2NvbHVtbnNcbiAgICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgICAgVkFMVUVTICgke3RhYmxlTmFtZUxpdGVyYWx9LCAnX2dlb20nLCAnUE9JTlQnLCA0MzI2LCAwLCAwKTtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9nZW9tIEJMT0I7XG5cbiAgICAgICAgSU5TRVJUIElOVE8gZ3BrZ19jb250ZW50cyAodGFibGVfbmFtZSwgZGF0YV90eXBlLCBpZGVudGlmaWVyLCBzcnNfaWQpXG4gICAgICAgIFNFTEVDVCAke3RhYmxlTmFtZUxpdGVyYWx9LCAnZmVhdHVyZXMnLCAke3RhYmxlTmFtZUxpdGVyYWx9LCA0MzI2XG4gICAgICAgIFdIRVJFIE5PVCBFWElTVFMgKFNFTEVDVCAxIEZST00gZ3BrZ19jb250ZW50cyBXSEVSRSB0YWJsZV9uYW1lID0gJHt0YWJsZU5hbWVMaXRlcmFsfSk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgXG4gICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBTRVQgX2dlb20gPSBncGtnTWFrZVBvaW50KF9sb25naXR1ZGUsIF9sYXRpdHVkZSwgNDMyNik7XG4gICAgYCk7XG4gIH1cblxuICBhc3luYyBlbmFibGVTcGF0aWFMaXRlKGRiKSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgbGV0IHNwYXRpYWxpdGVQYXRoID0gbnVsbDtcblxuICAgICAgLy8gdGhlIGRpZmZlcmVudCBwbGF0Zm9ybXMgYW5kIGNvbmZpZ3VyYXRpb25zIHJlcXVpcmUgdmFyaW91cyBkaWZmZXJlbnQgbG9hZCBwYXRocyBmb3IgdGhlIHNoYXJlZCBsaWJyYXJ5XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEUpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5lbnYuREVWRUxPUE1FTlQpIHtcbiAgICAgICAgbGV0IHBsYXRmb3JtID0gJ2xpbnV4JztcblxuICAgICAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ3dpbic7XG4gICAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICdtYWMnO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4oJy4nLCAncmVzb3VyY2VzJywgJ3NwYXRpYWxpdGUnLCBwbGF0Zm9ybSwgcHJvY2Vzcy5hcmNoLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnLi4nLCAnUmVzb3VyY2VzJywgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSAnbW9kX3NwYXRpYWxpdGUnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3BhdGlhbGl0ZVBhdGggPSBwYXRoLmpvaW4ocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH1cblxuICAgICAgZGIuZGF0YWJhc2UubG9hZEV4dGVuc2lvbihzcGF0aWFsaXRlUGF0aCwgKGVycikgPT4gZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKCkpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY2hlY2sgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIENoZWNrR2VvUGFja2FnZU1ldGFEYXRhKCkgQVMgcmVzdWx0Jyk7XG5cbiAgICBpZiAoY2hlY2tbMF0ucmVzdWx0ICE9PSAxKSB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBncGtnQ3JlYXRlQmFzZVRhYmxlcygpJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgRW5hYmxlR3BrZ01vZGUoKSBBUyBlbmFibGVkLCBHZXRHcGtnTW9kZSgpIEFTIG1vZGUnKTtcblxuICAgIGlmIChtb2RlWzBdLm1vZGUgIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5leHBlY3RlZCBlcnJvciB2ZXJpZnlpbmcgdGhlIEdQS0cgbW9kZScpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJ1blNRTChzcWwpIHtcbiAgICBsZXQgcmVzdWx0ID0gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmFsbChzcWwpO1xuICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICByZXN1bHQgPSB7ZXJyb3I6IGV4Lm1lc3NhZ2V9O1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICB9XG5cbiAgYXN5bmMgY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KSB7XG4gICAgYXdhaXQgdGhpcy5yZWxvYWRUYWJsZUxpc3QoKTtcblxuICAgIGNvbnN0IHRhYmxlTmFtZXMgPSBbXTtcblxuICAgIGNvbnN0IGZvcm1zID0gYXdhaXQgYWNjb3VudC5maW5kQWN0aXZlRm9ybXMoe30pO1xuXG4gICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICB0YWJsZU5hbWVzLnB1c2godGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtKSk7XG5cbiAgICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKTtcblxuICAgICAgICB0YWJsZU5hbWVzLnB1c2godGFibGVOYW1lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBmaW5kIGFueSB0YWJsZXMgdGhhdCBzaG91bGQgYmUgZHJvcHBlZCBiZWNhdXNlIHRoZXkgZ290IHJlbmFtZWRcbiAgICBmb3IgKGNvbnN0IGV4aXN0aW5nVGFibGVOYW1lIG9mIHRoaXMudGFibGVOYW1lcykge1xuICAgICAgaWYgKHRhYmxlTmFtZXMuaW5kZXhPZihleGlzdGluZ1RhYmxlTmFtZSkgPT09IC0xICYmICF0aGlzLmlzU3BlY2lhbFRhYmxlKGV4aXN0aW5nVGFibGVOYW1lKSkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bihgRFJPUCBUQUJMRSBJRiBFWElTVFMgbWFpbi4ke3RoaXMuZGIuaWRlbnQoZXhpc3RpbmdUYWJsZU5hbWUpfTtgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpc1NwZWNpYWxUYWJsZSh0YWJsZU5hbWUpIHtcbiAgICBpZiAodGFibGVOYW1lLmluZGV4T2YoJ2dwa2dfJykgPT09IDAgfHxcbiAgICAgICAgICB0YWJsZU5hbWUuaW5kZXhPZignc3FsaXRlXycpID09PSAwIHx8XG4gICAgICAgICAgdGFibGVOYW1lLmluZGV4T2YoJ2N1c3RvbV8nKSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgcmVsb2FkVGFibGVMaXN0KCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbChcIlNFTEVDVCB0YmxfbmFtZSBBUyBuYW1lIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0eXBlID0gJ3RhYmxlJztcIik7XG5cbiAgICB0aGlzLnRhYmxlTmFtZXMgPSByb3dzLm1hcChvID0+IG8ubmFtZSk7XG4gIH1cblxuICBnZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKSB7XG4gICAgY29uc3QgbmFtZSA9IHJlcGVhdGFibGUgPyBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWAgOiBmb3JtLm5hbWU7XG5cbiAgICByZXR1cm4gZnVsY3J1bS5hcmdzLmdwa2dVbmRlcnNjb3JlTmFtZXMgPyBzbmFrZShuYW1lKSA6IG5hbWU7XG4gIH1cbn1cbiJdfQ==