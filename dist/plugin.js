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
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwiam9pbiIsInBhcmVudFNRTCIsInRhYmxlTmFtZUxpdGVyYWwiLCJsaXRlcmFsIiwiZ2VvbVNRTCIsInRhc2siLCJjbGkiLCJjb21tYW5kIiwiZGVzYyIsImJ1aWxkZXIiLCJyZXF1aXJlZCIsInR5cGUiLCJoYW5kbGVyIiwiZGVmYXVsdERhdGFiYXNlT3B0aW9ucyIsIndhbCIsImF1dG9WYWN1dW0iLCJzeW5jaHJvbm91cyIsIm1rZGlycCIsIm9wdGlvbnMiLCJmaWxlIiwiZGlyIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJvbiIsImRlYWN0aXZhdGUiLCJjbG9zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3BhdGlhbGl0ZVBhdGgiLCJwcm9jZXNzIiwiZW52IiwiTU9EX1NQQVRJQUxJVEUiLCJERVZFTE9QTUVOVCIsInBsYXRmb3JtIiwiYXJjaCIsImRpcm5hbWUiLCJleGVjUGF0aCIsImRhdGFiYXNlIiwibG9hZEV4dGVuc2lvbiIsImVyciIsImNoZWNrIiwiYWxsIiwicm93cyIsIm1vZGUiLCJFcnJvciIsImV4IiwibWVzc2FnZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBZ0JuQkEsVUFoQm1CLHFCQWdCTixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVBLFVBQUlDLFFBQVFDLElBQVIsQ0FBYUMsR0FBakIsRUFBc0I7QUFDcEIsY0FBTSxNQUFLQyxNQUFMLENBQVlILFFBQVFDLElBQVIsQ0FBYUMsR0FBekIsQ0FBTjtBQUNBO0FBQ0Q7O0FBRUQsWUFBTUUsVUFBVSxNQUFNSixRQUFRSyxZQUFSLENBQXFCTCxRQUFRQyxJQUFSLENBQWFLLEdBQWxDLENBQXRCOztBQUVBLFVBQUlGLE9BQUosRUFBYTtBQUNYLGNBQU1HLFFBQVEsTUFBTUgsUUFBUUksZUFBUixDQUF3QixFQUF4QixDQUFwQjs7QUFFQSxhQUFLLE1BQU1DLElBQVgsSUFBbUJGLEtBQW5CLEVBQTBCO0FBQ3hCLGdCQUFNLE1BQUtHLFVBQUwsQ0FBZ0JELElBQWhCLEVBQXNCTCxPQUF0QixDQUFOO0FBQ0Q7QUFDRixPQU5ELE1BTU87QUFDTE8sZ0JBQVFDLEtBQVIsQ0FBYyx3QkFBZCxFQUF3Q1osUUFBUUMsSUFBUixDQUFhSyxHQUFyRDtBQUNEO0FBQ0YsS0FuQ2tCOztBQUFBLFNBZ0VuQk8sR0FoRW1CLEdBZ0VaWCxHQUFELElBQVM7QUFDYkEsWUFBTUEsSUFBSVksT0FBSixDQUFZLEtBQVosRUFBbUIsRUFBbkIsQ0FBTjs7QUFFQSxhQUFPLEtBQUtDLEVBQUwsQ0FBUUMsT0FBUixDQUFnQmQsR0FBaEIsQ0FBUDtBQUNELEtBcEVr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TzJGLEVBQVAsRUFBVztBQUNYdkQsaUJBQVMsRUFBQzFCLE9BQU9pRixHQUFHQyxPQUFYLEVBQVQ7QUFDRDs7QUFFRG5GLGNBQVFvRixHQUFSLENBQVlDLEtBQUtDLFNBQUwsQ0FBZTNELE1BQWYsQ0FBWjtBQVRnQjtBQVVqQjtBQTNPa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZmlsZTogcGF0aC5qb2luKGZ1bGNydW0uZGlyKCdnZW9wYWNrYWdlJyksIGZ1bGNydW0uYXJncy5vcmcgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICByZXR1cm4gdGhpcy5kYi5leGVjdXRlKHNxbCk7XG4gIH1cblxuICBvbkZvcm1TYXZlID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50LCBvbGRGb3JtLCBuZXdGb3JtfSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIG9uUmVjb3Jkc0ZpbmlzaGVkID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50fSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVJlY29yZCA9IGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0ocmVjb3JkLmZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlRm9ybSA9IGFzeW5jIChmb3JtLCBhY2NvdW50KSA9PiB7XG4gICAgY29uc3QgcmF3UGF0aCA9IGZ1bGNydW0uZGF0YWJhc2VGaWxlUGF0aDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGBBVFRBQ0ggREFUQUJBU0UgJyR7cmF3UGF0aH0nIGFzICdhcHAnYCk7XG5cbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKGZvcm0ubmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fdmlld19mdWxsYCwgbnVsbCk7XG5cbiAgICBmb3IgKGNvbnN0IHJlcGVhdGFibGUgb2YgZm9ybS5lbGVtZW50c09mVHlwZSgnUmVwZWF0YWJsZScpKSB7XG4gICAgICBjb25zdCB0YWJsZU5hbWUgPSBgJHtmb3JtLm5hbWV9IC0gJHtyZXBlYXRhYmxlLmRhdGFOYW1lfWA7XG5cbiAgICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUodGFibGVOYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV8ke3JlcGVhdGFibGUua2V5fV92aWV3X2Z1bGxgLCByZXBlYXRhYmxlKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgREVUQUNIIERBVEFCQVNFICdhcHAnYCk7XG4gIH1cblxuICB1cGRhdGVUYWJsZSA9IGFzeW5jICh0YWJsZU5hbWUsIHNvdXJjZVRhYmxlTmFtZSwgcmVwZWF0YWJsZSkgPT4ge1xuICAgIGNvbnN0IHRlbXBUYWJsZU5hbWUgPSBzb3VyY2VUYWJsZU5hbWUgKyAnX3RtcCc7XG5cbiAgICBjb25zdCBkcm9wVGVtcGxhdGUgPSBgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfTtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlVGFibGUgPSBgQ1JFQVRFIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX0gQVMgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oY3JlYXRlVGVtcGxhdGVUYWJsZSk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmdldChgU0VMRUNUIHNxbCBGUk9NIHNxbGl0ZV9tYXN0ZXIgV0hFUkUgdGJsX25hbWUgPSAnJHt0ZW1wVGFibGVOYW1lfSdgKTtcbiAgICBjb25zdCB7Y29sdW1uc30gPSBhd2FpdCB0aGlzLmRiLmV4ZWN1dGUoYFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YCk7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlID0gcmVzdWx0LnNxbC5yZXBsYWNlKHRlbXBUYWJsZU5hbWUsIHRoaXMuZGIuaWRlbnQodGFibGVOYW1lKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoJyhcXG4nLCAnIChfaWQgSU5URUdFUiBQUklNQVJZIEtFWSBBVVRPSU5DUkVNRU5ULCAnKTtcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVzID0gY29sdW1ucy5tYXAobyA9PiB0aGlzLmRiLmlkZW50KG8ubmFtZSkpO1xuXG4gICAgbGV0IG9yZGVyQnkgPSAnT1JERVIgQlkgX3JlY29yZF9pZCc7XG5cbiAgICBpZiAocmVwZWF0YWJsZSAhPSBudWxsKSB7XG4gICAgICBvcmRlckJ5ID0gJ09SREVSIEJZIF9jaGlsZF9yZWNvcmRfaWQnO1xuICAgIH1cblxuICAgIGNvbnN0IGFsbFNRTCA9IGBcbiAgICAgIERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfTtcblxuICAgICAgJHsgY3JlYXRlIH07XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF9jcmVhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgQUREIF91cGRhdGVkX2J5X2VtYWlsIFRFWFQ7XG5cbiAgICAgIElOU0VSVCBJTlRPICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSAoJHtjb2x1bW5OYW1lcy5qb2luKCcsICcpfSwgX2NyZWF0ZWRfYnlfZW1haWwsIF91cGRhdGVkX2J5X2VtYWlsKVxuICAgICAgU0VMRUNUICR7Y29sdW1uTmFtZXMubWFwKG8gPT4gJ3QuJyArIG8pLmpvaW4oJywgJyl9LCBtYy5lbWFpbCBBUyBfY3JlYXRlZF9ieV9lbWFpbCwgbXUuZW1haWwgQVMgX3VwZGF0ZWRfYnlfZW1haWxcbiAgICAgIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSB0XG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbWMgT04gdC5fY3JlYXRlZF9ieV9pZCA9IG1jLnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtdSBPTiB0Ll91cGRhdGVkX2J5X2lkID0gbXUudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgJHtvcmRlckJ5fTtcbiAgICBgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYWxsU1FMKTtcblxuICAgIGlmIChyZXBlYXRhYmxlID09IG51bGwpIHtcbiAgICAgIGNvbnN0IHBhcmVudFNRTCA9IGBcbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfYXNzaWduZWRfdG9fZW1haWwgVEVYVDtcblxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9wcm9qZWN0X25hbWUgVEVYVDtcblxuICAgICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIFNFVCBfYXNzaWduZWRfdG9fZW1haWwgPSAoU0VMRUNUIGVtYWlsIEZST00gYXBwLm1lbWJlcnNoaXBzIG0gV0hFUkUgbS51c2VyX3Jlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9hc3NpZ25lZF90b19pZCksXG4gICAgICAgIF9wcm9qZWN0X25hbWUgPSAoU0VMRUNUIG5hbWUgRlJPTSBhcHAucHJvamVjdHMgcCBXSEVSRSBwLnJlc291cmNlX2lkID0gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9Ll9wcm9qZWN0X2lkKTtcbiAgICAgIGA7XG5cbiAgICAgIGF3YWl0IHRoaXMucnVuKHBhcmVudFNRTCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGVOYW1lTGl0ZXJhbCA9IHRoaXMuZGIubGl0ZXJhbCh0YWJsZU5hbWUpO1xuXG4gICAgY29uc3QgZ2VvbVNRTCA9IGBcbiAgICAgIERFTEVURSBGUk9NIGdwa2dfZ2VvbWV0cnlfY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lPSR7dGFibGVOYW1lTGl0ZXJhbH07XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgIFZBTFVFUyAoJHt0YWJsZU5hbWVMaXRlcmFsfSwgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuXG4gICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgIFNFTEVDVCAke3RhYmxlTmFtZUxpdGVyYWx9LCAnZmVhdHVyZXMnLCAke3RhYmxlTmFtZUxpdGVyYWx9LCA0MzI2XG4gICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICR7dGFibGVOYW1lTGl0ZXJhbH0pO1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBsZXQgcGxhdGZvcm0gPSAnbGludXgnO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnd2luJztcbiAgICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICAgIHBsYXRmb3JtID0gJ21hYyc7XG4gICAgICAgIH1cblxuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsIHBsYXRmb3JtLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cbn1cbiJdfQ==