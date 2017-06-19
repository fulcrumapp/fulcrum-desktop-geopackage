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
          gpkgname: {
            desc: 'database name',
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

      const databaseName = fulcrum.args.gpkgname || fulcrum.args.org;

      const options = {
        file: _path2.default.join(fulcrum.dir('geopackage'), databaseName + '.gpkg')
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsImdldEZyaWVuZGx5VGFibGVOYW1lIiwicm93SUQiLCJyZXBlYXRhYmxlIiwiZWxlbWVudHNPZlR5cGUiLCJ0YWJsZU5hbWUiLCJrZXkiLCJjbGVhbnVwVGFibGVzIiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3AiLCJkcm9wVGVtcGxhdGUiLCJpZGVudCIsImNyZWF0ZVRlbXBsYXRlVGFibGUiLCJyZXN1bHQiLCJnZXQiLCJjb2x1bW5zIiwiY3JlYXRlIiwiY29sdW1uTmFtZXMiLCJtYXAiLCJvIiwibmFtZSIsIm9yZGVyQnkiLCJwcm9sb2d1ZSIsImV4aXN0aW5nVGFibGUiLCJhbGxTUUwiLCJqb2luIiwicGFyZW50U1FMIiwidGFibGVOYW1lTGl0ZXJhbCIsImxpdGVyYWwiLCJnZW9tU1FMIiwidGFzayIsImNsaSIsImNvbW1hbmQiLCJkZXNjIiwiYnVpbGRlciIsInJlcXVpcmVkIiwidHlwZSIsImdwa2duYW1lIiwiZGVmYXVsdCIsImhhbmRsZXIiLCJkZWZhdWx0RGF0YWJhc2VPcHRpb25zIiwid2FsIiwiYXV0b1ZhY3V1bSIsInN5bmNocm9ub3VzIiwibWtkaXJwIiwiZGF0YWJhc2VOYW1lIiwib3B0aW9ucyIsImZpbGUiLCJkaXIiLCJvcGVuIiwiZW5hYmxlU3BhdGlhTGl0ZSIsIm9uIiwiZGVhY3RpdmF0ZSIsImNsb3NlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJzcGF0aWFsaXRlUGF0aCIsInByb2Nlc3MiLCJlbnYiLCJNT0RfU1BBVElBTElURSIsIkRFVkVMT1BNRU5UIiwicGxhdGZvcm0iLCJhcmNoIiwiZGlybmFtZSIsImV4ZWNQYXRoIiwiZGF0YWJhc2UiLCJsb2FkRXh0ZW5zaW9uIiwiZXJyIiwiY2hlY2siLCJhbGwiLCJyb3dzIiwibW9kZSIsIkVycm9yIiwiZXgiLCJtZXNzYWdlIiwibG9nIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlbG9hZFRhYmxlTGlzdCIsInRhYmxlTmFtZXMiLCJwdXNoIiwiZXhpc3RpbmdUYWJsZU5hbWUiLCJpbmRleE9mIiwiaXNTcGVjaWFsVGFibGUiLCJkYXRhTmFtZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7Ozs7a0JBRWUsTUFBTTtBQUFBO0FBQUE7O0FBQUEsU0EyQm5CQSxVQTNCbUIscUJBMkJOLGFBQVk7QUFDdkIsWUFBTSxNQUFLQyxRQUFMLEVBQU47O0FBRUEsVUFBSUMsUUFBUUMsSUFBUixDQUFhQyxHQUFqQixFQUFzQjtBQUNwQixjQUFNLE1BQUtDLE1BQUwsQ0FBWUgsUUFBUUMsSUFBUixDQUFhQyxHQUF6QixDQUFOO0FBQ0E7QUFDRDs7QUFFRCxZQUFNRSxVQUFVLE1BQU1KLFFBQVFLLFlBQVIsQ0FBcUJMLFFBQVFDLElBQVIsQ0FBYUssR0FBbEMsQ0FBdEI7O0FBRUEsVUFBSUYsT0FBSixFQUFhO0FBQ1gsY0FBTUcsUUFBUSxNQUFNSCxRQUFRSSxlQUFSLENBQXdCLEVBQXhCLENBQXBCOztBQUVBLGFBQUssTUFBTUMsSUFBWCxJQUFtQkYsS0FBbkIsRUFBMEI7QUFDeEIsZ0JBQU0sTUFBS0csVUFBTCxDQUFnQkQsSUFBaEIsRUFBc0JMLE9BQXRCLENBQU47QUFDRDtBQUNGLE9BTkQsTUFNTztBQUNMTyxnQkFBUUMsS0FBUixDQUFjLHdCQUFkLEVB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LE9BQWxCLE1BQStCLENBQS9CLElBQ0UvRSxVQUFVK0UsT0FBVixDQUFrQixTQUFsQixNQUFpQyxDQURuQyxJQUVFL0UsVUFBVStFLE9BQVYsQ0FBa0IsU0FBbEIsTUFBaUMsQ0FGdkMsRUFFMEM7QUFDeEMsYUFBTyxJQUFQO0FBQ0Q7O0FBRUQsV0FBTyxLQUFQO0FBQ0Q7O0FBRUtKLGlCQUFOLEdBQXdCO0FBQUE7O0FBQUE7QUFDdEIsWUFBTVIsT0FBTyxNQUFNLE9BQUtsRixFQUFMLENBQVFpRixHQUFSLENBQVksa0VBQVosQ0FBbkI7O0FBRUEsYUFBS1UsVUFBTCxHQUFrQlQsS0FBS3JELEdBQUwsQ0FBUztBQUFBLGVBQUtDLEVBQUVDLElBQVA7QUFBQSxPQUFULENBQWxCO0FBSHNCO0FBSXZCOztBQUVEcEIsdUJBQXFCakIsSUFBckIsRUFBMkJtQixVQUEzQixFQUF1QztBQUNyQyxXQUFPQSxhQUFjLEdBQUVuQixLQUFLcUMsSUFBSyxNQUFLbEIsV0FBV21GLFFBQVMsRUFBbkQsR0FBdUR0RyxLQUFLcUMsSUFBbkU7QUFDRDtBQS9Ua0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIGdwa2duYW1lOiB7XG4gICAgICAgICAgZGVzYzogJ2RhdGFiYXNlIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBkcm9wOiB7XG4gICAgICAgICAgZGVzYzogJ2Ryb3AgdGFibGVzIGZpcnN0JyxcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgdHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBpZiAoZnVsY3J1bS5hcmdzLnNxbCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5TUUwoZnVsY3J1bS5hcmdzLnNxbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGZvcm1zID0gYXdhaXQgYWNjb3VudC5maW5kQWN0aXZlRm9ybXMoe30pO1xuXG4gICAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdVbmFibGUgdG8gZmluZCBhY2NvdW50JywgZnVsY3J1bS5hcmdzLm9yZyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGUoKSB7XG4gICAgY29uc3QgZGVmYXVsdERhdGFiYXNlT3B0aW9ucyA9IHtcbiAgICAgIHdhbDogdHJ1ZSxcbiAgICAgIGF1dG9WYWN1dW06IHRydWUsXG4gICAgICBzeW5jaHJvbm91czogJ29mZidcbiAgICB9O1xuXG4gICAgZnVsY3J1bS5ta2RpcnAoJ2dlb3BhY2thZ2UnKTtcblxuICAgIGNvbnN0IGRhdGFiYXNlTmFtZSA9IGZ1bGNydW0uYXJncy5ncGtnbmFtZSB8fCBmdWxjcnVtLmFyZ3Mub3JnO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpLCBkYXRhYmFzZU5hbWUgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICByZXR1cm4gdGhpcy5kYi5leGVjdXRlKHNxbCk7XG4gIH1cblxuICBvbkZvcm1TYXZlID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50LCBvbGRGb3JtLCBuZXdGb3JtfSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIG9uUmVjb3Jkc0ZpbmlzaGVkID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50fSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVJlY29yZCA9IGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0ocmVjb3JkLmZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlRm9ybSA9IGFzeW5jIChmb3JtLCBhY2NvdW50KSA9PiB7XG4gICAgY29uc3QgcmF3UGF0aCA9IGZ1bGNydW0uZGF0YWJhc2VGaWxlUGF0aDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGBBVFRBQ0ggREFUQUJBU0UgJyR7cmF3UGF0aH0nIGFzICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSksIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9X3ZpZXdfZnVsbGAsIG51bGwpO1xuXG4gICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy5nZXRGcmllbmRseVRhYmxlTmFtZShmb3JtLCByZXBlYXRhYmxlKTtcblxuICAgICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0YWJsZU5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9XyR7cmVwZWF0YWJsZS5rZXl9X3ZpZXdfZnVsbGAsIHJlcGVhdGFibGUpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKGBERVRBQ0ggREFUQUJBU0UgJ2FwcCdgKTtcblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cFRhYmxlcyhmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVRhYmxlID0gYXN5bmMgKHRhYmxlTmFtZSwgc291cmNlVGFibGVOYW1lLCByZXBlYXRhYmxlKSA9PiB7XG4gICAgY29uc3QgdGVtcFRhYmxlTmFtZSA9IHNvdXJjZVRhYmxlTmFtZSArICdfdG1wJztcblxuICAgIGxldCBkcm9wID0gZnVsY3J1bS5hcmdzLmRyb3AgIT0gbnVsbCA/IGZ1bGNydW0uYXJncy5kcm9wIDogdHJ1ZTtcblxuICAgIGNvbnN0IGRyb3BUZW1wbGF0ZSA9IGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9O2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlVGVtcGxhdGVUYWJsZSA9IGBDUkVBVEUgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfSBBUyBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihjcmVhdGVUZW1wbGF0ZVRhYmxlKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RlbXBUYWJsZU5hbWV9J2ApO1xuICAgIGNvbnN0IHtjb2x1bW5zfSA9IGF3YWl0IHRoaXMuZGIuZXhlY3V0ZShgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgKTtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGUgPSByZXN1bHQuc3FsLnJlcGxhY2UodGVtcFRhYmxlTmFtZSwgdGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgnKFxcbicsICcgKF9pZCBJTlRFR0VSIFBSSU1BUlkgS0VZIEFVVE9JTkNSRU1FTlQsICcpO1xuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBjb2x1bW5zLm1hcChvID0+IHRoaXMuZGIuaWRlbnQoby5uYW1lKSk7XG5cbiAgICBsZXQgb3JkZXJCeSA9ICdPUkRFUiBCWSBfcmVjb3JkX2lkJztcblxuICAgIGlmIChyZXBlYXRhYmxlICE9IG51bGwpIHtcbiAgICAgIG9yZGVyQnkgPSAnT1JERVIgQlkgX2NoaWxkX3JlY29yZF9pZCc7XG4gICAgfVxuXG4gICAgbGV0IHByb2xvZ3VlID0gJyc7XG5cbiAgICBjb25zdCBleGlzdGluZ1RhYmxlID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGFibGVOYW1lfSdgKTtcblxuICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICBwcm9sb2d1ZSA9IGBcbiAgICAgICAgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9O1xuXG4gICAgICAgICR7IGNyZWF0ZSB9O1xuXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX2NyZWF0ZWRfYnlfZW1haWwgVEVYVDtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF91cGRhdGVkX2J5X2VtYWlsIFRFWFQ7XG4gICAgICBgO1xuICAgIH1cblxuICAgIGNvbnN0IGFsbFNRTCA9IGBcbiAgICAgICR7IHByb2xvZ3VlIH1cblxuICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9LCBfY3JlYXRlZF9ieV9lbWFpbCwgX3VwZGF0ZWRfYnlfZW1haWwpXG4gICAgICBTRUxFQ1QgJHtjb2x1bW5OYW1lcy5tYXAobyA9PiAndC4nICsgbykuam9pbignLCAnKX0sIG1jLmVtYWlsIEFTIF9jcmVhdGVkX2J5X2VtYWlsLCBtdS5lbWFpbCBBUyBfdXBkYXRlZF9ieV9lbWFpbFxuICAgICAgRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IHRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtYyBPTiB0Ll9jcmVhdGVkX2J5X2lkID0gbWMudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG11IE9OIHQuX3VwZGF0ZWRfYnlfaWQgPSBtdS51c2VyX3Jlc291cmNlX2lkXG4gICAgICAke29yZGVyQnl9O1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihhbGxTUUwpO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgPT0gbnVsbCkge1xuICAgICAgcHJvbG9ndWUgPSAnJztcblxuICAgICAgaWYgKGRyb3AgfHwgIWV4aXN0aW5nVGFibGUpIHtcbiAgICAgICAgcHJvbG9ndWUgPSBgXG4gICAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgICAgQUREIF9hc3NpZ25lZF90b19lbWFpbCBURVhUO1xuXG4gICAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgICAgQUREIF9wcm9qZWN0X25hbWUgVEVYVDtcbiAgICAgICAgYDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFyZW50U1FMID0gYFxuICAgICAgICAkeyBwcm9sb2d1ZSB9XG5cbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBTRVQgX2Fzc2lnbmVkX3RvX2VtYWlsID0gKFNFTEVDVCBlbWFpbCBGUk9NIGFwcC5tZW1iZXJzaGlwcyBtIFdIRVJFIG0udXNlcl9yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fYXNzaWduZWRfdG9faWQpLFxuICAgICAgICBfcHJvamVjdF9uYW1lID0gKFNFTEVDVCBuYW1lIEZST00gYXBwLnByb2plY3RzIHAgV0hFUkUgcC5yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fcHJvamVjdF9pZCk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihwYXJlbnRTUUwpO1xuICAgIH1cblxuICAgIGlmIChkcm9wIHx8ICFleGlzdGluZ1RhYmxlKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWVMaXRlcmFsID0gdGhpcy5kYi5saXRlcmFsKHRhYmxlTmFtZSk7XG5cbiAgICAgIGNvbnN0IGdlb21TUUwgPSBgXG4gICAgICAgIERFTEVURSBGUk9NIGdwa2dfZ2VvbWV0cnlfY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lPSR7dGFibGVOYW1lTGl0ZXJhbH07XG5cbiAgICAgICAgSU5TRVJUIElOVE8gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zXG4gICAgICAgICh0YWJsZV9uYW1lLCBjb2x1bW5fbmFtZSwgZ2VvbWV0cnlfdHlwZV9uYW1lLCBzcnNfaWQsIHosIG0pXG4gICAgICAgIFZBTFVFUyAoJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfZ2VvbSBCTE9CO1xuXG4gICAgICAgIElOU0VSVCBJTlRPIGdwa2dfY29udGVudHMgKHRhYmxlX25hbWUsIGRhdGFfdHlwZSwgaWRlbnRpZmllciwgc3JzX2lkKVxuICAgICAgICBTRUxFQ1QgJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ2ZlYXR1cmVzJywgJHt0YWJsZU5hbWVMaXRlcmFsfSwgNDMyNlxuICAgICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICR7dGFibGVOYW1lTGl0ZXJhbH0pO1xuICAgICAgYDtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4oZ2VvbVNRTCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYFxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuICAgIGApO1xuICB9XG5cbiAgYXN5bmMgZW5hYmxlU3BhdGlhTGl0ZShkYikge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBzcGF0aWFsaXRlUGF0aCA9IG51bGw7XG5cbiAgICAgIC8vIHRoZSBkaWZmZXJlbnQgcGxhdGZvcm1zIGFuZCBjb25maWd1cmF0aW9ucyByZXF1aXJlIHZhcmlvdXMgZGlmZmVyZW50IGxvYWQgcGF0aHMgZm9yIHRoZSBzaGFyZWQgbGlicmFyeVxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEU7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MuZW52LkRFVkVMT1BNRU5UKSB7XG4gICAgICAgIGxldCBwbGF0Zm9ybSA9ICdsaW51eCc7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICd3aW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnbWFjJztcbiAgICAgICAgfVxuXG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKCcuJywgJ3Jlc291cmNlcycsICdzcGF0aWFsaXRlJywgcGxhdGZvcm0sIHByb2Nlc3MuYXJjaCwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uJywgJ1Jlc291cmNlcycsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gJ21vZF9zcGF0aWFsaXRlJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRiLmRhdGFiYXNlLmxvYWRFeHRlbnNpb24oc3BhdGlhbGl0ZVBhdGgsIChlcnIpID0+IGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNoZWNrID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBDaGVja0dlb1BhY2thZ2VNZXRhRGF0YSgpIEFTIHJlc3VsdCcpO1xuXG4gICAgaWYgKGNoZWNrWzBdLnJlc3VsdCAhPT0gMSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgZ3BrZ0NyZWF0ZUJhc2VUYWJsZXMoKScpO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIEVuYWJsZUdwa2dNb2RlKCkgQVMgZW5hYmxlZCwgR2V0R3BrZ01vZGUoKSBBUyBtb2RlJyk7XG5cbiAgICBpZiAobW9kZVswXS5tb2RlICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgdmVyaWZ5aW5nIHRoZSBHUEtHIG1vZGUnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBydW5TUUwoc3FsKSB7XG4gICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5hbGwoc3FsKTtcbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmVzdWx0ID0ge2Vycm9yOiBleC5tZXNzYWdlfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgfVxuXG4gIGFzeW5jIGNsZWFudXBUYWJsZXMoZm9ybSwgYWNjb3VudCkge1xuICAgIGF3YWl0IHRoaXMucmVsb2FkVGFibGVMaXN0KCk7XG5cbiAgICBjb25zdCB0YWJsZU5hbWVzID0gW107XG5cbiAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgdGFibGVOYW1lcy5wdXNoKHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSkpO1xuXG4gICAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMuZ2V0RnJpZW5kbHlUYWJsZU5hbWUoZm9ybSwgcmVwZWF0YWJsZSk7XG5cbiAgICAgICAgdGFibGVOYW1lcy5wdXNoKHRhYmxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gZmluZCBhbnkgdGFibGVzIHRoYXQgc2hvdWxkIGJlIGRyb3BwZWQgYmVjYXVzZSB0aGV5IGdvdCByZW5hbWVkXG4gICAgZm9yIChjb25zdCBleGlzdGluZ1RhYmxlTmFtZSBvZiB0aGlzLnRhYmxlTmFtZXMpIHtcbiAgICAgIGlmICh0YWJsZU5hbWVzLmluZGV4T2YoZXhpc3RpbmdUYWJsZU5hbWUpID09PSAtMSAmJiAhdGhpcy5pc1NwZWNpYWxUYWJsZShleGlzdGluZ1RhYmxlTmFtZSkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW4oYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudChleGlzdGluZ1RhYmxlTmFtZSl9O2ApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlzU3BlY2lhbFRhYmxlKHRhYmxlTmFtZSkge1xuICAgIGlmICh0YWJsZU5hbWUuaW5kZXhPZignZ3BrZ18nKSA9PT0gMCB8fFxuICAgICAgICAgIHRhYmxlTmFtZS5pbmRleE9mKCdzcWxpdGVfJykgPT09IDAgfHxcbiAgICAgICAgICB0YWJsZU5hbWUuaW5kZXhPZignY3VzdG9tXycpID09PSAwKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBhc3luYyByZWxvYWRUYWJsZUxpc3QoKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKFwiU0VMRUNUIHRibF9uYW1lIEFTIG5hbWUgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHR5cGUgPSAndGFibGUnO1wiKTtcblxuICAgIHRoaXMudGFibGVOYW1lcyA9IHJvd3MubWFwKG8gPT4gby5uYW1lKTtcbiAgfVxuXG4gIGdldEZyaWVuZGx5VGFibGVOYW1lKGZvcm0sIHJlcGVhdGFibGUpIHtcbiAgICByZXR1cm4gcmVwZWF0YWJsZSA/IGAke2Zvcm0ubmFtZX0gLSAke3JlcGVhdGFibGUuZGF0YU5hbWV9YCA6IGZvcm0ubmFtZTtcbiAgfVxufVxuIl19