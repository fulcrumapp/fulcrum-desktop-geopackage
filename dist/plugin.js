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
      DELETE FROM gpkg_geometry_columns WHERE table_name='${tableNameLiteral}';

      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id, z, m)
      VALUES ('${tableNameLiteral}', '_geom', 'POINT', 4326, 0, 0);

      ALTER TABLE ${_this.db.ident(tableName)} ADD _geom BLOB;

      UPDATE ${_this.db.ident(tableName)}
      SET _geom = gpkgMakePoint(_longitude, _latitude, 4326);

      INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
      SELECT '${tableNameLiteral}', 'features', '${tableNameLiteral}', 4326
      WHERE NOT EXISTS (SELECT 1 FROM gpkg_contents WHERE table_name = '${tableNameLiteral}');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwiam9pbiIsInBhcmVudFNRTCIsInRhYmxlTmFtZUxpdGVyYWwiLCJsaXRlcmFsIiwiZ2VvbVNRTCIsInRhc2siLCJjbGkiLCJjb21tYW5kIiwiZGVzYyIsImJ1aWxkZXIiLCJyZXF1aXJlZCIsInR5cGUiLCJoYW5kbGVyIiwiZGVmYXVsdERhdGFiYXNlT3B0aW9ucyIsIndhbCIsImF1dG9WYWN1dW0iLCJzeW5jaHJvbm91cyIsIm1rZGlycCIsIm9wdGlvbnMiLCJmaWxlIiwiZGlyIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJvbiIsImRlYWN0aXZhdGUiLCJjbG9zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3BhdGlhbGl0ZVBhdGgiLCJwcm9jZXNzIiwiZW52IiwiTU9EX1NQQVRJQUxJVEUiLCJERVZFTE9QTUVOVCIsInBsYXRmb3JtIiwiYXJjaCIsImRpcm5hbWUiLCJleGVjUGF0aCIsImRhdGFiYXNlIiwibG9hZEV4dGVuc2lvbiIsImVyciIsImNoZWNrIiwiYWxsIiwicm93cyIsIm1vZGUiLCJFcnJvciIsImV4IiwibWVzc2FnZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBZ0JuQkEsVUFoQm1CLHFCQWdCTixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVBLFVBQUlDLFFBQVFDLElBQVIsQ0FBYUMsR0FBakIsRUFBc0I7QUFDcEIsY0FBTSxNQUFLQyxNQUFMLENBQVlILFFBQVFDLElBQVIsQ0FBYUMsR0FBekIsQ0FBTjtBQUNBO0FBQ0Q7O0FBRUQsWUFBTUUsVUFBVSxNQUFNSixRQUFRSyxZQUFSLENBQXFCTCxRQUFRQyxJQUFSLENBQWFLLEdBQWxDLENBQXRCOztBQUVBLFVBQUlGLE9BQUosRUFBYTtBQUNYLGNBQU1HLFFBQVEsTUFBTUgsUUFBUUksZUFBUixDQUF3QixFQUF4QixDQUFwQjs7QUFFQSxhQUFLLE1BQU1DLElBQVgsSUFBbUJGLEtBQW5CLEVBQTBCO0FBQ3hCLGdCQUFNLE1BQUtHLFVBQUwsQ0FBZ0JELElBQWhCLEVBQXNCTCxPQUF0QixDQUFOO0FBQ0Q7QUFDRixPQU5ELE1BTU87QUFDTE8sZ0JBQVFDLEtBQVIsQ0FBYyx3QkFBZCxFQUF3Q1osUUFBUUMsSUFBUixDQUFhSyxHQUFyRDtBQUNEO0FBQ0YsS0FuQ2tCOztBQUFBLFNBZ0VuQk8sR0FoRW1CLEdBZ0VaWCxHQUFELElBQVM7QUFDYkEsWUFBTUEsSUFBSVksT0FBSixDQUFZLEtBQVosRUFBbUIsRUFBbkIsQ0FBTjs7QUFFQSxhQUFPLEtBQUtDLEVBQUwsQ0FBUUMsT0FBUixDQUFnQmQsR0FBaEIsQ0FBUDtBQUNELEtBcEVr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QU8yRixFQUFQLEVBQVc7QUFDWHZELGlCQUFTLEVBQUMxQixPQUFPaUYsR0FBR0MsT0FBWCxFQUFUO0FBQ0Q7O0FBRURuRixjQUFRb0YsR0FBUixDQUFZQyxLQUFLQyxTQUFMLENBQWUzRCxNQUFmLENBQVo7QUFUZ0I7QUFVakI7QUEzT2tCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBTUUxpdGUgfSBmcm9tICdmdWxjcnVtJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnZ2VvcGFja2FnZScsXG4gICAgICBkZXNjOiAnY3JlYXRlIGEgZ2VvcGFja2FnZSBkYXRhYmFzZSBmb3IgYW4gb3JnYW5pemF0aW9uJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3Muc3FsKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blNRTChmdWxjcnVtLmFyZ3Muc3FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICBjb25zdCBkZWZhdWx0RGF0YWJhc2VPcHRpb25zID0ge1xuICAgICAgd2FsOiB0cnVlLFxuICAgICAgYXV0b1ZhY3V1bTogdHJ1ZSxcbiAgICAgIHN5bmNocm9ub3VzOiAnb2ZmJ1xuICAgIH07XG5cbiAgICBmdWxjcnVtLm1rZGlycCgnZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpLCBmdWxjcnVtLmFyZ3Mub3JnICsgJy5ncGtnJylcbiAgICB9O1xuXG4gICAgdGhpcy5kYiA9IGF3YWl0IFNRTGl0ZS5vcGVuKHsuLi5kZWZhdWx0RGF0YWJhc2VPcHRpb25zLCAuLi5vcHRpb25zfSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuYWJsZVNwYXRpYUxpdGUodGhpcy5kYik7XG5cbiAgICBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICAgIGlmICh0aGlzLmRiKSB7XG4gICAgICBhd2FpdCB0aGlzLmRiLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgcnVuID0gKHNxbCkgPT4ge1xuICAgIHNxbCA9IHNxbC5yZXBsYWNlKC9cXDAvZywgJycpO1xuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZShmb3JtLm5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9X3ZpZXdfZnVsbGAsIG51bGwpO1xuXG4gICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gO1xuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlTmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fJHtyZXBlYXRhYmxlLmtleX1fdmlld19mdWxsYCwgcmVwZWF0YWJsZSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYERFVEFDSCBEQVRBQkFTRSAnYXBwJ2ApO1xuICB9XG5cbiAgdXBkYXRlVGFibGUgPSBhc3luYyAodGFibGVOYW1lLCBzb3VyY2VUYWJsZU5hbWUsIHJlcGVhdGFibGUpID0+IHtcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gc291cmNlVGFibGVOYW1lICsgJ190bXAnO1xuXG4gICAgY29uc3QgZHJvcFRlbXBsYXRlID0gYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX07YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZVRhYmxlID0gYENSRUFURSBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9IEFTIFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGNyZWF0ZVRlbXBsYXRlVGFibGUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGVtcFRhYmxlTmFtZX0nYCk7XG4gICAgY29uc3Qge2NvbHVtbnN9ID0gYXdhaXQgdGhpcy5kYi5leGVjdXRlKGBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2ApO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZSA9IHJlc3VsdC5zcWwucmVwbGFjZSh0ZW1wVGFibGVOYW1lLCB0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKCcoXFxuJywgJyAoX2lkIElOVEVHRVIgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyk7XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGNvbHVtbnMubWFwKG8gPT4gdGhpcy5kYi5pZGVudChvLm5hbWUpKTtcblxuICAgIGxldCBvcmRlckJ5ID0gJ09SREVSIEJZIF9yZWNvcmRfaWQnO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgIT0gbnVsbCkge1xuICAgICAgb3JkZXJCeSA9ICdPUkRFUiBCWSBfY2hpbGRfcmVjb3JkX2lkJztcbiAgICB9XG5cbiAgICBjb25zdCBhbGxTUUwgPSBgXG4gICAgICBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX07XG5cbiAgICAgICR7IGNyZWF0ZSB9O1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBJTlNFUlQgSU5UTyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gKCR7Y29sdW1uTmFtZXMuam9pbignLCAnKX0sIF9jcmVhdGVkX2J5X2VtYWlsLCBfdXBkYXRlZF9ieV9lbWFpbClcbiAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfSwgbWMuZW1haWwgQVMgX2NyZWF0ZWRfYnlfZW1haWwsIG11LmVtYWlsIEFTIF91cGRhdGVkX2J5X2VtYWlsXG4gICAgICBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gdFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG1jIE9OIHQuX2NyZWF0ZWRfYnlfaWQgPSBtYy51c2VyX3Jlc291cmNlX2lkXG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbXUgT04gdC5fdXBkYXRlZF9ieV9pZCA9IG11LnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICR7b3JkZXJCeX07XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGFsbFNRTCk7XG5cbiAgICBpZiAocmVwZWF0YWJsZSA9PSBudWxsKSB7XG4gICAgICBjb25zdCBwYXJlbnRTUUwgPSBgXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX2Fzc2lnbmVkX3RvX2VtYWlsIFRFWFQ7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfcHJvamVjdF9uYW1lIFRFWFQ7XG5cbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBTRVQgX2Fzc2lnbmVkX3RvX2VtYWlsID0gKFNFTEVDVCBlbWFpbCBGUk9NIGFwcC5tZW1iZXJzaGlwcyBtIFdIRVJFIG0udXNlcl9yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fYXNzaWduZWRfdG9faWQpLFxuICAgICAgICBfcHJvamVjdF9uYW1lID0gKFNFTEVDVCBuYW1lIEZST00gYXBwLnByb2plY3RzIHAgV0hFUkUgcC5yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fcHJvamVjdF9pZCk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihwYXJlbnRTUUwpO1xuICAgIH1cblxuICAgIGNvbnN0IHRhYmxlTmFtZUxpdGVyYWwgPSB0aGlzLmRiLmxpdGVyYWwodGFibGVOYW1lKTtcblxuICAgIGNvbnN0IGdlb21TUUwgPSBgXG4gICAgICBERUxFVEUgRlJPTSBncGtnX2dlb21ldHJ5X2NvbHVtbnMgV0hFUkUgdGFibGVfbmFtZT0nJHt0YWJsZU5hbWVMaXRlcmFsfSc7XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgIFZBTFVFUyAoJyR7dGFibGVOYW1lTGl0ZXJhbH0nLCAnX2dlb20nLCAnUE9JTlQnLCA0MzI2LCAwLCAwKTtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9IEFERCBfZ2VvbSBCTE9CO1xuXG4gICAgICBVUERBVEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBTRVQgX2dlb20gPSBncGtnTWFrZVBvaW50KF9sb25naXR1ZGUsIF9sYXRpdHVkZSwgNDMyNik7XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfY29udGVudHMgKHRhYmxlX25hbWUsIGRhdGFfdHlwZSwgaWRlbnRpZmllciwgc3JzX2lkKVxuICAgICAgU0VMRUNUICcke3RhYmxlTmFtZUxpdGVyYWx9JywgJ2ZlYXR1cmVzJywgJyR7dGFibGVOYW1lTGl0ZXJhbH0nLCA0MzI2XG4gICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICcke3RhYmxlTmFtZUxpdGVyYWx9Jyk7XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGdlb21TUUwpO1xuICB9XG5cbiAgYXN5bmMgZW5hYmxlU3BhdGlhTGl0ZShkYikge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCBzcGF0aWFsaXRlUGF0aCA9IG51bGw7XG5cbiAgICAgIC8vIHRoZSBkaWZmZXJlbnQgcGxhdGZvcm1zIGFuZCBjb25maWd1cmF0aW9ucyByZXF1aXJlIHZhcmlvdXMgZGlmZmVyZW50IGxvYWQgcGF0aHMgZm9yIHRoZSBzaGFyZWQgbGlicmFyeVxuICAgICAgaWYgKHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcHJvY2Vzcy5lbnYuTU9EX1NQQVRJQUxJVEU7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MuZW52LkRFVkVMT1BNRU5UKSB7XG4gICAgICAgIGxldCBwbGF0Zm9ybSA9ICdsaW51eCc7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBwbGF0Zm9ybSA9ICd3aW4nO1xuICAgICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgICAgcGxhdGZvcm0gPSAnbWFjJztcbiAgICAgICAgfVxuXG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKCcuJywgJ3Jlc291cmNlcycsICdzcGF0aWFsaXRlJywgcGxhdGZvcm0sIHByb2Nlc3MuYXJjaCwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJy4uJywgJ1Jlc291cmNlcycsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gJ21vZF9zcGF0aWFsaXRlJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNwYXRpYWxpdGVQYXRoID0gcGF0aC5qb2luKHBhdGguZGlybmFtZShwcm9jZXNzLmV4ZWNQYXRoKSwgJ21vZF9zcGF0aWFsaXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRiLmRhdGFiYXNlLmxvYWRFeHRlbnNpb24oc3BhdGlhbGl0ZVBhdGgsIChlcnIpID0+IGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNoZWNrID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBDaGVja0dlb1BhY2thZ2VNZXRhRGF0YSgpIEFTIHJlc3VsdCcpO1xuXG4gICAgaWYgKGNoZWNrWzBdLnJlc3VsdCAhPT0gMSkge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgZ3BrZ0NyZWF0ZUJhc2VUYWJsZXMoKScpO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZGUgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIEVuYWJsZUdwa2dNb2RlKCkgQVMgZW5hYmxlZCwgR2V0R3BrZ01vZGUoKSBBUyBtb2RlJyk7XG5cbiAgICBpZiAobW9kZVswXS5tb2RlICE9PSAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgZXJyb3IgdmVyaWZ5aW5nIHRoZSBHUEtHIG1vZGUnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBydW5TUUwoc3FsKSB7XG4gICAgbGV0IHJlc3VsdCA9IG51bGw7XG5cbiAgICB0cnkge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5hbGwoc3FsKTtcbiAgICB9IGNhdGNoIChleCkge1xuICAgICAgcmVzdWx0ID0ge2Vycm9yOiBleC5tZXNzYWdlfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShyZXN1bHQpKTtcbiAgfVxufVxuIl19