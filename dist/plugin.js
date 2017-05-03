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
          spatialitePath = _path2.default.join('.', 'resources', 'spatialite', 'mac', process.arch, 'mod_spatialite');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImRhdGFiYXNlRmlsZVBhdGgiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwiam9pbiIsInBhcmVudFNRTCIsImdlb21TUUwiLCJ0YXNrIiwiY2xpIiwiY29tbWFuZCIsImRlc2MiLCJidWlsZGVyIiwicmVxdWlyZWQiLCJ0eXBlIiwiaGFuZGxlciIsImRlZmF1bHREYXRhYmFzZU9wdGlvbnMiLCJ3YWwiLCJhdXRvVmFjdXVtIiwic3luY2hyb25vdXMiLCJta2RpcnAiLCJvcHRpb25zIiwiZmlsZSIsImRpciIsIm9wZW4iLCJlbmFibGVTcGF0aWFMaXRlIiwib24iLCJkZWFjdGl2YXRlIiwiY2xvc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInNwYXRpYWxpdGVQYXRoIiwicHJvY2VzcyIsImVudiIsIk1PRF9TUEFUSUFMSVRFIiwiREVWRUxPUE1FTlQiLCJhcmNoIiwicGxhdGZvcm0iLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5Il0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQWdCbkJBLFVBaEJtQixxQkFnQk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxVQUFJQyxRQUFRQyxJQUFSLENBQWFDLEdBQWpCLEVBQXNCO0FBQ3BCLGNBQU0sTUFBS0MsTUFBTCxDQUFZSCxRQUFRQyxJQUFSLENBQWFDLEdBQXpCLENBQU47QUFDQTtBQUNEOztBQUVELFlBQU1FLFVBQVUsTUFBTUosUUFBUUssWUFBUixDQUFxQkwsUUFBUUMsSUFBUixDQUFhSyxHQUFsQyxDQUF0Qjs7QUFFQSxVQUFJRixPQUFKLEVBQWE7QUFDWCxjQUFNRyxRQUFRLE1BQU1ILFFBQVFJLGVBQVIsQ0FBd0IsRUFBeEIsQ0FBcEI7O0FBRUEsYUFBSyxNQUFNQyxJQUFYLElBQW1CRixLQUFuQixFQUEwQjtBQUN4QixnQkFBTSxNQUFLRyxVQUFMLENBQWdCRCxJQUFoQixFQUFzQkwsT0FBdEIsQ0FBTjtBQUNEO0FBQ0YsT0FORCxNQU1PO0FBQ0xPLGdCQUFRQyxLQUFSLENBQWMsd0JBQWQsRUFBd0NaLFFBQVFDLElBQVIsQ0FBYUssR0FBckQ7QUFDRDtBQUNGLEtBbkNrQjs7QUFBQSxTQWdFbkJPLEdBaEVtQixHQWdFWlgsR0FBRCxJQUFTO0FBQ2JBLFlBQU1BLElBQUlZLE9BQUosQ0FBWSxLQUFaLEVBQW1CLEVBQW5CLENBQU47O0FBRUEsYUFBTyxLQUFLQyxFQUFMLENBQVFDLE9BQVIsQ0FBZ0JkLEdBQWhCLENBQVA7QUFDRCxLQXBFa0I7O0FBQUEsU0FzRW5CZSxVQXRFbUI7QUFBQSxv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OztBQUVEbkUsV0FBR29FLFFBQUgsQ0FBWUMsYUFBWixDQUEwQlYsY0FBMUIsRUFBMEMsVUFBQ1csR0FBRDtBQUFBLGlCQUFTQSxNQUFNWixPQUFPWSxHQUFQLENBQU4sR0FBb0JiLFNBQTdCO0FBQUEsU0FBMUM7QUFDRCxPQWpCSyxDQUFOOztBQW1CQSxZQUFNYyxRQUFRLE1BQU0sT0FBS3ZFLEVBQUwsQ0FBUXdFLEdBQVIsQ0FBWSw0Q0FBWixDQUFwQjs7QUFFQSxVQUFJRCxNQUFNLENBQU4sRUFBU2hELE1BQVQsS0FBb0IsQ0FBeEIsRUFBMkI7QUFDekIsY0FBTWtELE9BQU8sTUFBTSxPQUFLekUsRUFBTCxDQUFRd0UsR0FBUixDQUFZLCtCQUFaLENBQW5CO0FBQ0Q7O0FBRUQsWUFBTUUsT0FBTyxNQUFNLE9BQUsxRSxFQUFMLENBQVF3RSxHQUFSLENBQVksMkRBQVosQ0FBbkI7O0FBRUEsVUFBSUUsS0FBSyxDQUFMLEVBQVFBLElBQVIsS0FBaUIsQ0FBckIsRUFBd0I7QUFDdEIsY0FBTSxJQUFJQyxLQUFKLENBQVUsMENBQVYsQ0FBTjtBQUNEO0FBOUJ3QjtBQStCMUI7O0FBRUt2RixRQUFOLENBQWFELEdBQWIsRUFBa0I7QUFBQTs7QUFBQTtBQUNoQixVQUFJb0MsU0FBUyxJQUFiOztBQUVBLFVBQUk7QUFDRkEsaUJBQVMsTUFBTSxPQUFLdkIsRUFBTCxDQUFRd0UsR0FBUixDQUFZckYsR0FBWixDQUFmO0FBQ0QsT0FGRCxDQUVFLE9BQU95RixFQUFQLEVBQVc7QUFDWHJELGlCQUFTLEVBQUMxQixPQUFPK0UsR0FBR0MsT0FBWCxFQUFUO0FBQ0Q7O0FBRURqRixjQUFRa0YsR0FBUixDQUFZQyxLQUFLQyxTQUFMLENBQWV6RCxNQUFmLENBQVo7QUFUZ0I7QUFVakI7QUFqT2tCLEMiLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBTUUxpdGUgfSBmcm9tICdmdWxjcnVtJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3Mge1xuICBhc3luYyB0YXNrKGNsaSkge1xuICAgIHJldHVybiBjbGkuY29tbWFuZCh7XG4gICAgICBjb21tYW5kOiAnZ2VvcGFja2FnZScsXG4gICAgICBkZXNjOiAnY3JlYXRlIGEgZ2VvcGFja2FnZSBkYXRhYmFzZSBmb3IgYW4gb3JnYW5pemF0aW9uJyxcbiAgICAgIGJ1aWxkZXI6IHtcbiAgICAgICAgb3JnOiB7XG4gICAgICAgICAgZGVzYzogJ29yZ2FuaXphdGlvbiBuYW1lJyxcbiAgICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICB0eXBlOiAnc3RyaW5nJ1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgaGFuZGxlcjogdGhpcy5ydW5Db21tYW5kXG4gICAgfSk7XG4gIH1cblxuICBydW5Db21tYW5kID0gYXN5bmMgKCkgPT4ge1xuICAgIGF3YWl0IHRoaXMuYWN0aXZhdGUoKTtcblxuICAgIGlmIChmdWxjcnVtLmFyZ3Muc3FsKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blNRTChmdWxjcnVtLmFyZ3Muc3FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgZnVsY3J1bS5mZXRjaEFjY291bnQoZnVsY3J1bS5hcmdzLm9yZyk7XG5cbiAgICBpZiAoYWNjb3VudCkge1xuICAgICAgY29uc3QgZm9ybXMgPSBhd2FpdCBhY2NvdW50LmZpbmRBY3RpdmVGb3Jtcyh7fSk7XG5cbiAgICAgIGZvciAoY29uc3QgZm9ybSBvZiBmb3Jtcykge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VuYWJsZSB0byBmaW5kIGFjY291bnQnLCBmdWxjcnVtLmFyZ3Mub3JnKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBhY3RpdmF0ZSgpIHtcbiAgICBjb25zdCBkZWZhdWx0RGF0YWJhc2VPcHRpb25zID0ge1xuICAgICAgd2FsOiB0cnVlLFxuICAgICAgYXV0b1ZhY3V1bTogdHJ1ZSxcbiAgICAgIHN5bmNocm9ub3VzOiAnb2ZmJ1xuICAgIH07XG5cbiAgICBmdWxjcnVtLm1rZGlycCgnZ2VvcGFja2FnZScpO1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGU6IHBhdGguam9pbihmdWxjcnVtLmRpcignZ2VvcGFja2FnZScpLCBmdWxjcnVtLmFyZ3Mub3JnICsgJy5ncGtnJylcbiAgICB9O1xuXG4gICAgdGhpcy5kYiA9IGF3YWl0IFNRTGl0ZS5vcGVuKHsuLi5kZWZhdWx0RGF0YWJhc2VPcHRpb25zLCAuLi5vcHRpb25zfSk7XG5cbiAgICBhd2FpdCB0aGlzLmVuYWJsZVNwYXRpYUxpdGUodGhpcy5kYik7XG5cbiAgICBmdWxjcnVtLm9uKCdmb3JtOnNhdmUnLCB0aGlzLm9uRm9ybVNhdmUpO1xuICAgIGZ1bGNydW0ub24oJ3JlY29yZHM6ZmluaXNoJywgdGhpcy5vblJlY29yZHNGaW5pc2hlZCk7XG4gIH1cblxuICBhc3luYyBkZWFjdGl2YXRlKCkge1xuICAgIGlmICh0aGlzLmRiKSB7XG4gICAgICBhd2FpdCB0aGlzLmRiLmNsb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgcnVuID0gKHNxbCkgPT4ge1xuICAgIHNxbCA9IHNxbC5yZXBsYWNlKC9cXDAvZywgJycpO1xuXG4gICAgcmV0dXJuIHRoaXMuZGIuZXhlY3V0ZShzcWwpO1xuICB9XG5cbiAgb25Gb3JtU2F2ZSA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudCwgb2xkRm9ybSwgbmV3Rm9ybX0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICBvblJlY29yZHNGaW5pc2hlZCA9IGFzeW5jICh7Zm9ybSwgYWNjb3VudH0pID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0oZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVSZWNvcmQgPSBhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKHJlY29yZC5mb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZUZvcm0gPSBhc3luYyAoZm9ybSwgYWNjb3VudCkgPT4ge1xuICAgIGNvbnN0IHJhd1BhdGggPSBmdWxjcnVtLmRhdGFiYXNlRmlsZVBhdGg7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZShmb3JtLm5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9X3ZpZXdfZnVsbGAsIG51bGwpO1xuXG4gICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gO1xuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlTmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fJHtyZXBlYXRhYmxlLmtleX1fdmlld19mdWxsYCwgcmVwZWF0YWJsZSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYERFVEFDSCBEQVRBQkFTRSAnYXBwJ2ApO1xuICB9XG5cbiAgdXBkYXRlVGFibGUgPSBhc3luYyAodGFibGVOYW1lLCBzb3VyY2VUYWJsZU5hbWUsIHJlcGVhdGFibGUpID0+IHtcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gc291cmNlVGFibGVOYW1lICsgJ190bXAnO1xuXG4gICAgY29uc3QgZHJvcFRlbXBsYXRlID0gYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX07YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZVRhYmxlID0gYENSRUFURSBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9IEFTIFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGNyZWF0ZVRlbXBsYXRlVGFibGUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGVtcFRhYmxlTmFtZX0nYCk7XG4gICAgY29uc3Qge2NvbHVtbnN9ID0gYXdhaXQgdGhpcy5kYi5leGVjdXRlKGBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2ApO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZSA9IHJlc3VsdC5zcWwucmVwbGFjZSh0ZW1wVGFibGVOYW1lLCB0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKCcoXFxuJywgJyAoX2lkIElOVEVHRVIgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyk7XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGNvbHVtbnMubWFwKG8gPT4gdGhpcy5kYi5pZGVudChvLm5hbWUpKTtcblxuICAgIGxldCBvcmRlckJ5ID0gJ09SREVSIEJZIF9yZWNvcmRfaWQnO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgIT0gbnVsbCkge1xuICAgICAgb3JkZXJCeSA9ICdPUkRFUiBCWSBfY2hpbGRfcmVjb3JkX2lkJztcbiAgICB9XG5cbiAgICBjb25zdCBhbGxTUUwgPSBgXG4gICAgICBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX07XG5cbiAgICAgICR7IGNyZWF0ZSB9O1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBJTlNFUlQgSU5UTyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gKCR7Y29sdW1uTmFtZXMuam9pbignLCAnKX0sIF9jcmVhdGVkX2J5X2VtYWlsLCBfdXBkYXRlZF9ieV9lbWFpbClcbiAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfSwgbWMuZW1haWwgQVMgX2NyZWF0ZWRfYnlfZW1haWwsIG11LmVtYWlsIEFTIF91cGRhdGVkX2J5X2VtYWlsXG4gICAgICBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gdFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG1jIE9OIHQuX2NyZWF0ZWRfYnlfaWQgPSBtYy51c2VyX3Jlc291cmNlX2lkXG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbXUgT04gdC5fdXBkYXRlZF9ieV9pZCA9IG11LnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICR7b3JkZXJCeX07XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGFsbFNRTCk7XG5cbiAgICBpZiAocmVwZWF0YWJsZSA9PSBudWxsKSB7XG4gICAgICBjb25zdCBwYXJlbnRTUUwgPSBgXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX2Fzc2lnbmVkX3RvX2VtYWlsIFRFWFQ7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfcHJvamVjdF9uYW1lIFRFWFQ7XG5cbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBTRVQgX2Fzc2lnbmVkX3RvX2VtYWlsID0gKFNFTEVDVCBlbWFpbCBGUk9NIGFwcC5tZW1iZXJzaGlwcyBtIFdIRVJFIG0udXNlcl9yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fYXNzaWduZWRfdG9faWQpLFxuICAgICAgICBfcHJvamVjdF9uYW1lID0gKFNFTEVDVCBuYW1lIEZST00gYXBwLnByb2plY3RzIHAgV0hFUkUgcC5yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fcHJvamVjdF9pZCk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihwYXJlbnRTUUwpO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb21TUUwgPSBgXG4gICAgICBERUxFVEUgRlJPTSBncGtnX2dlb21ldHJ5X2NvbHVtbnMgV0hFUkUgdGFibGVfbmFtZT0nJHt0YWJsZU5hbWV9JztcblxuICAgICAgSU5TRVJUIElOVE8gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zXG4gICAgICAodGFibGVfbmFtZSwgY29sdW1uX25hbWUsIGdlb21ldHJ5X3R5cGVfbmFtZSwgc3JzX2lkLCB6LCBtKVxuICAgICAgVkFMVUVTICgnJHt0YWJsZU5hbWV9JywgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuXG4gICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgIFNFTEVDVCAnJHt0YWJsZU5hbWV9JywgJ2ZlYXR1cmVzJywgJyR7dGFibGVOYW1lfScsIDQzMjZcbiAgICAgIFdIRVJFIE5PVCBFWElTVFMgKFNFTEVDVCAxIEZST00gZ3BrZ19jb250ZW50cyBXSEVSRSB0YWJsZV9uYW1lID0gJyR7dGFibGVOYW1lfScpO1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsICdtYWMnLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cbn1cbiJdfQ==