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

        yield _this.updateTable(form.name, `account_${account.rowID}_form_${form.rowID}_view_full`, null);

        for (const repeatable of form.elementsOfType('Repeatable')) {
          const tableName = `${form.name} - ${repeatable.dataName}`;

          yield _this.updateTable(tableName, `account_${account.rowID}_form_${form.rowID}_${repeatable.key}_view_full`, repeatable);
        }

        yield _this.run(`DETACH DATABASE 'app'`);
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

        const geomSQL = `
      DELETE FROM gpkg_geometry_columns WHERE table_name='${tableName}';

      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id, z, m)
      VALUES ('${tableName}', '_geom', 'POINT', 4326, 0, 0);

      ALTER TABLE ${_this.db.ident(tableName)} ADD _geom BLOB;

      UPDATE ${_this.db.ident(tableName)}
      SET _geom = gpkgMakePoint(_longitude, _latitude, 4326);

      INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
      SELECT '${tableName}', 'features', '${tableName}', 4326
      WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = '${tableName}');
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
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwiam9pbiIsInBhcmVudFNRTCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJvcHRpb25zIiwiZmlsZSIsImRpciIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwib24iLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJwbGF0Zm9ybSIsImFyY2giLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5Il0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQWdCbkJBLFVBaEJtQixxQkFnQk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxVQUFJQyxRQUFRQyxJQUFSLENBQWFDLEdBQWpCLEVBQXNCO0FBQ3BCLGNBQU0sTUFBS0MsTUFBTCxDQUFZSCxRQUFRQyxJQUFSLENBQWFDLEdBQXpCLENBQU47QUFDQTtBQUNEOztBQUVELFlBQU1FLFVBQVUsTUFBTUosUUFBUUssWUFBUixDQUFxQkwsUUFBUUMsSUFBUixDQUFhSyxHQUFsQyxDQUF0Qjs7QUFFQSxVQUFJRixPQUFKLEVBQWE7QUFDWCxjQUFNRyxRQUFRLE1BQU1ILFFBQVFJLGVBQVIsQ0FBd0IsRUFBeEIsQ0FBcEI7O0FBRUEsYUFBSyxNQUFNQyxJQUFYLElBQW1CRixLQUFuQixFQUEwQjtBQUN4QixnQkFBTSxNQUFLRyxVQUFMLENBQWdCRCxJQUFoQixFQUFzQkwsT0FBdEIsQ0FBTjtBQUNEO0FBQ0YsT0FORCxNQU1PO0FBQ0xPLGdCQUFRQyxLQUFSLENBQWMsd0JBQWQsRUFBd0NaLFFBQVFDLElBQVIsQ0FBYUssR0FBckQ7QUFDRDtBQUNGLEtBbkNrQjs7QUFBQSxTQWdFbkJPLEdBaEVtQixHQWdFWlgsR0FBRCxJQUFTO0FBQ2JBLFlBQU1BLElBQUlZLE9BQUosQ0FBWSxLQUFaLEVBQW1CLEVBQW5CLENBQU47O0FBRUEsYUFBTyxLQUFLQyxFQUFMLENBQVFDLE9BQVIsQ0FBZ0JkLEdBQWhCLENBQVA7QUFDRCxLQXBFa0I7O0FBQUEsU0FzRW5CZSxVQXRFbUI7QUFBQSxv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ZXpELE1BQWYsQ0FBWjtBQVRnQjtBQVVqQjtBQXpPa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZmlsZTogcGF0aC5qb2luKGZ1bGNydW0uZGlyKCdnZW9wYWNrYWdlJyksIGZ1bGNydW0uYXJncy5vcmcgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICByZXR1cm4gdGhpcy5kYi5leGVjdXRlKHNxbCk7XG4gIH1cblxuICBvbkZvcm1TYXZlID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50LCBvbGRGb3JtLCBuZXdGb3JtfSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIG9uUmVjb3Jkc0ZpbmlzaGVkID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50fSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVJlY29yZCA9IGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0ocmVjb3JkLmZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlRm9ybSA9IGFzeW5jIChmb3JtLCBhY2NvdW50KSA9PiB7XG4gICAgY29uc3QgcmF3UGF0aCA9IGZ1bGNydW0uZGF0YWJhc2VGaWxlUGF0aDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGBBVFRBQ0ggREFUQUJBU0UgJyR7cmF3UGF0aH0nIGFzICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKGZvcm0ubmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fdmlld19mdWxsYCwgbnVsbCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWUgPSBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWA7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBjb25zdCBkcm9wVGVtcGxhdGUgPSBgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfTtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlVGFibGUgPSBgQ1JFQVRFIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX0gQVMgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oY3JlYXRlVGVtcGxhdGVUYWJsZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmdldChgU0VMRUNUIHNxbCBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdGJsX25hbWUgPSAnJHt0ZW1wVGFibGVOYW1lfSdgKTtcbiAgICBjb25zdCB7Y29sdW1uc30gPSBhd2FpdCB0aGlzLmRiLmV4ZWN1dGUoYFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YCk7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlID0gcmVzdWx0LnNxbC5yZXBsYWNlKHRlbXBUYWJsZU5hbWUsIHRoaXMuZGIuaWRlbnQodGFibGVOYW1lKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoJyhcXG4nLCAnIChfaWQgSU5URUdFUiBQUklNQVJZIEtFWSBBVVRPSU5DUkVNRU5ULCAnKTtcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gY29sdW1ucy5tYXAobyA9PiB0aGlzLmRiLmlkZW50KG8ubmFtZSkpO1xuXG4gICAgbGV0IG9yZGVyQnkgPSAnT1JERVIgQlkgX3JlY29yZF9pZCc7XG5cbiAgICBpZiAocmVwZWF0YWJsZSAhPSBudWxsKSB7XG4gICAgICBvcmRlckJ5ID0gJ09SREVSIEJZIF9jaGlsZF9yZWNvcmRfaWQnO1xuICAgIH1cblxuICAgIGNvbnN0IGFsbFNRTCA9IGBcbiAgICAgIERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtcblxuICAgICAgJHsgY3JlYXRlIH07XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF9jcmVhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF91cGRhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSwgX2NyZWF0ZWRfYnlfZW1haWwsIF91cGRhdGVkX2J5X2VtYWlsKVxuICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9LCBtYy5lbWFpbCBBUyBfY3JlYXRlZF9ieV9lbWFpbCwgbXUuZW1haWwgQVMgX3VwZGF0ZWRfYnlfZW1haWxcbiAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbWMgT04gdC5fY3JlYXRlZF9ieV9pZCA9IG1jLnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtdSBPTiB0Ll91cGRhdGVkX2J5X2lkID0gbXUudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgJHtvcmRlckJ5fTtcbiAgICBgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYWxsU1FMKTtcblxuICAgIGlmIChyZXBlYXRhYmxlID09IG51bGwpIHtcbiAgICAgIGNvbnN0IHBhcmVudFNRTCA9IGBcbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfYXNzaWduZWRfdG9fZW1haWwgVEVYVDtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9wcm9qZWN0X25hbWUgVEVYVDtcblxuICAgICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIFNFVCBfYXNzaWduZWRfdG9fZW1haWwgPSAoU0VMRUNUIGVtYWlsIEZST00gYXBwLm1lbWJlcnNoaXBzIG0gV0hFUkUgbS51c2VyX3Jlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9hc3NpZ25lZF90b19pZCksXG4gICAgICAgIF9wcm9qZWN0X25hbWUgPSAoU0VMRUNUIG5hbWUgRlJPTSBhcHAucHJvamVjdHMgcCBXSEVSRSBwLnJlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9wcm9qZWN0X2lkKTtcbiAgICAgIGA7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKHBhcmVudFNRTCk7XG4gICAgfVxuXG4gICAgY29uc3QgZ2VvbVNRTCA9IGBcbiAgICAgIERFTEVURSBGUk9NIGdwa2dfZ2VvbWV0cnlfY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lPScke3RhYmxlTmFtZX0nO1xuXG4gICAgICBJTlNFUlQgSU5UTyBncGtnX2dlb21ldHJ5X2NvbHVtbnNcbiAgICAgICh0YWJsZV9uYW1lLCBjb2x1bW5fbmFtZSwgZ2VvbWV0cnlfdHlwZV9uYW1lLCBzcnNfaWQsIHosIG0pXG4gICAgICBWQUxVRVMgKCcke3RhYmxlTmFtZX0nLCAnX2dlb20nLCAnUE9JTlQnLCA0MzI2LCAwLCAwKTtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfZ2VvbSBCTE9CO1xuXG4gICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBTRVQgX2dlb20gPSBncGtnTWFrZVBvaW50KF9sb25naXR1ZGUsIF9sYXRpdHVkZSwgNDMyNik7XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfY29udGVudHMgKHRhYmxlX25hbWUsIGRhdGFfdHlwZSwgaWRlbnRpZmllciwgc3JzX2lkKVxuICAgICAgU0VMRUNUICcke3RhYmxlTmFtZX0nLCAnZmVhdHVyZXMnLCAnJHt0YWJsZU5hbWV9JywgNDMyNlxuICAgICAgV0hFUkUgTk9UIEVYSVNUUyAoU0VMRUNUIDEgRlJPTSBncGtnX2NvbnRlbnRzIFdIRVJFIHRhYmxlX25hbWUgPSAnJHt0YWJsZU5hbWV9Jyk7XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGdlb21TUUwpO1xuICB9XG5cbiAgYXN5bmMgZW5hYmxlU3BhdGlhTGl0ZShkYikge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBzcGF0aWFsaXRlUGF0aCA9IG51bGw7XG5cbiAgICAgIC8vIHRoZSBkaWZmZXJlbnQgcGxhdGZvcm1zIGFuZCBjb25maWd1cmF0aW9ucyByZXF1aXJlIHZhcmlvdXMgZGlmZmVyZW50IGxvYWQgcGF0aHMgZm9yIHRoZSBzaGFyZWQgbGlicmFyeVxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEU7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MuZW52LkRFVkVMT1BNRU5UKSB7XG4gICAgICAgIGxldCBwbGF0Zm9ybSA9ICdsaW51eCc7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICd3aW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnbWFjJztcbiAgICAgICAgfVxuXG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKCcuJywgJ3Jlc291cmNlcycsICdzcGF0aWFsaXRlJywgcGxhdGZvcm0sIHByb2Nlc3MuYXJjaCwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uJywgJ1Jlc291cmNlcycsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gJ21vZF9zcGF0aWFsaXRlJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRiLmRhdGFiYXNlLmxvYWRFeHRlbnNpb24oc3BhdGlhbGl0ZVBhdGgsIChlcnIpID0+IGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNoZWNrID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBDaGVja0dlb1BhY2thZ2VNZXRhRGF0YSgpIEFTIHJlc3VsdCcpO1xuXG4gICAgaWYgKGNoZWNrWzBdLnJlc3VsdCAhPT0gMSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgZ3BrZ0NyZWF0ZUJhc2VUYWJsZXMoKScpO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIEVuYWJsZUdwa2dNb2RlKCkgQVMgZW5hYmxlZCwgR2V0R3BrZ01vZGUoKSBBUyBtb2RlJyk7XG5cbiAgICBpZiAobW9kZVswXS5tb2RlICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgdmVyaWZ5aW5nIHRoZSBHUEtHIG1vZGUnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBydW5TUUwoc3FsKSB7XG4gICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5hbGwoc3FsKTtcbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmVzdWx0ID0ge2Vycm9yOiBleC5tZXNzYWdlfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgfVxufVxuIl19