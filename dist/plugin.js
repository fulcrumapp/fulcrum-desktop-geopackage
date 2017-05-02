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
        const rawPath = _path2.default.join(fulcrum.dir('data'), 'fulcrum.db');

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

        const create = result.sql.replace(tempTableName, _this.db.ident(tableName)).replace('(', ' (\n_id INTEGER PRIMARY KEY AUTOINCREMENT, ');

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImpvaW4iLCJkaXIiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwicGFyZW50U1FMIiwiZ2VvbVNRTCIsInRhc2siLCJjbGkiLCJjb21tYW5kIiwiZGVzYyIsImJ1aWxkZXIiLCJyZXF1aXJlZCIsInR5cGUiLCJoYW5kbGVyIiwiZGVmYXVsdERhdGFiYXNlT3B0aW9ucyIsIndhbCIsImF1dG9WYWN1dW0iLCJzeW5jaHJvbm91cyIsIm1rZGlycCIsIm9wdGlvbnMiLCJmaWxlIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJvbiIsImRlYWN0aXZhdGUiLCJjbG9zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3BhdGlhbGl0ZVBhdGgiLCJwcm9jZXNzIiwiZW52IiwiTU9EX1NQQVRJQUxJVEUiLCJERVZFTE9QTUVOVCIsImFyY2giLCJwbGF0Zm9ybSIsImRpcm5hbWUiLCJleGVjUGF0aCIsImRhdGFiYXNlIiwibG9hZEV4dGVuc2lvbiIsImVyciIsImNoZWNrIiwiYWxsIiwicm93cyIsIm1vZGUiLCJFcnJvciIsImV4IiwibWVzc2FnZSIsImxvZyIsIkpTT04iLCJzdHJpbmdpZnkiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7Ozs7QUFDQTs7Ozs7O2tCQUVlLE1BQU07QUFBQTtBQUFBOztBQUFBLFNBZ0JuQkEsVUFoQm1CLHFCQWdCTixhQUFZO0FBQ3ZCLFlBQU0sTUFBS0MsUUFBTCxFQUFOOztBQUVBLFVBQUlDLFFBQVFDLElBQVIsQ0FBYUMsR0FBakIsRUFBc0I7QUFDcEIsY0FBTSxNQUFLQyxNQUFMLENBQVlILFFBQVFDLElBQVIsQ0FBYUMsR0FBekIsQ0FBTjtBQUNBO0FBQ0Q7O0FBRUQsWUFBTUUsVUFBVSxNQUFNSixRQUFRSyxZQUFSLENBQXFCTCxRQUFRQyxJQUFSLENBQWFLLEdBQWxDLENBQXRCOztBQUVBLFVBQUlGLE9BQUosRUFBYTtBQUNYLGNBQU1HLFFBQVEsTUFBTUgsUUFBUUksZUFBUixDQUF3QixFQUF4QixDQUFwQjs7QUFFQSxhQUFLLE1BQU1DLElBQVgsSUFBbUJGLEtBQW5CLEVBQTBCO0FBQ3hCLGdCQUFNLE1BQUtHLFVBQUwsQ0FBZ0JELElBQWhCLEVBQXNCTCxPQUF0QixDQUFOO0FBQ0Q7QUFDRixPQU5ELE1BTU87QUFDTE8sZ0JBQVFDLEtBQVIsQ0FBYyx3QkFBZCxFQUF3Q1osUUFBUUMsSUFBUixDQUFhSyxHQUFyRDtBQUNEO0FBQ0YsS0FuQ2tCOztBQUFBLFNBZ0VuQk8sR0FoRW1CLEdBZ0VaWCxHQUFELElBQVM7QUFDYkEsWUFBTUEsSUFBSVksT0FBSixDQUFZLEtBQVosRUFBbUIsRUFBbkIsQ0FBTjs7QUFFQSxhQUFPLEtBQUtDLEVBQUwsQ0FBUUMsT0FBUixDQUFnQmQsR0FBaEIsQ0FBUDtBQUNELEtBcEVrQjs7QUFBQSxTQXNFbkJlLFVBdEVtQjtBQUFBLG9DQXNFTixXQUFPLEVBQUNSLElB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UUFBUU8sUUFBckIsQ0FBVixFQUEwQyxnQkFBMUMsQ0FBakI7QUFDRDs7QUFFRGxFLFdBQUdtRSxRQUFILENBQVlDLGFBQVosQ0FBMEJWLGNBQTFCLEVBQTBDLFVBQUNXLEdBQUQ7QUFBQSxpQkFBU0EsTUFBTVosT0FBT1ksR0FBUCxDQUFOLEdBQW9CYixTQUE3QjtBQUFBLFNBQTFDO0FBQ0QsT0FqQkssQ0FBTjs7QUFtQkEsWUFBTWMsUUFBUSxNQUFNLE9BQUt0RSxFQUFMLENBQVF1RSxHQUFSLENBQVksNENBQVosQ0FBcEI7O0FBRUEsVUFBSUQsTUFBTSxDQUFOLEVBQVM5QyxNQUFULEtBQW9CLENBQXhCLEVBQTJCO0FBQ3pCLGNBQU1nRCxPQUFPLE1BQU0sT0FBS3hFLEVBQUwsQ0FBUXVFLEdBQVIsQ0FBWSwrQkFBWixDQUFuQjtBQUNEOztBQUVELFlBQU1FLE9BQU8sTUFBTSxPQUFLekUsRUFBTCxDQUFRdUUsR0FBUixDQUFZLDJEQUFaLENBQW5COztBQUVBLFVBQUlFLEtBQUssQ0FBTCxFQUFRQSxJQUFSLEtBQWlCLENBQXJCLEVBQXdCO0FBQ3RCLGNBQU0sSUFBSUMsS0FBSixDQUFVLDBDQUFWLENBQU47QUFDRDtBQTlCd0I7QUErQjFCOztBQUVLdEYsUUFBTixDQUFhRCxHQUFiLEVBQWtCO0FBQUE7O0FBQUE7QUFDaEIsVUFBSXFDLFNBQVMsSUFBYjs7QUFFQSxVQUFJO0FBQ0ZBLGlCQUFTLE1BQU0sT0FBS3hCLEVBQUwsQ0FBUXVFLEdBQVIsQ0FBWXBGLEdBQVosQ0FBZjtBQUNELE9BRkQsQ0FFRSxPQUFPd0YsRUFBUCxFQUFXO0FBQ1huRCxpQkFBUyxFQUFDM0IsT0FBTzhFLEdBQUdDLE9BQVgsRUFBVDtBQUNEOztBQUVEaEYsY0FBUWlGLEdBQVIsQ0FBWUMsS0FBS0MsU0FBTCxDQUFldkQsTUFBZixDQUFaO0FBVGdCO0FBVWpCO0FBak9rQixDIiwiZmlsZSI6InBsdWdpbi5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgU1FMaXRlIH0gZnJvbSAnZnVsY3J1bSc7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIHtcbiAgYXN5bmMgdGFzayhjbGkpIHtcbiAgICByZXR1cm4gY2xpLmNvbW1hbmQoe1xuICAgICAgY29tbWFuZDogJ2dlb3BhY2thZ2UnLFxuICAgICAgZGVzYzogJ2NyZWF0ZSBhIGdlb3BhY2thZ2UgZGF0YWJhc2UgZm9yIGFuIG9yZ2FuaXphdGlvbicsXG4gICAgICBidWlsZGVyOiB7XG4gICAgICAgIG9yZzoge1xuICAgICAgICAgIGRlc2M6ICdvcmdhbml6YXRpb24gbmFtZScsXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgdHlwZTogJ3N0cmluZydcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGhhbmRsZXI6IHRoaXMucnVuQ29tbWFuZFxuICAgIH0pO1xuICB9XG5cbiAgcnVuQ29tbWFuZCA9IGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCB0aGlzLmFjdGl2YXRlKCk7XG5cbiAgICBpZiAoZnVsY3J1bS5hcmdzLnNxbCkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5TUUwoZnVsY3J1bS5hcmdzLnNxbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGZ1bGNydW0uZmV0Y2hBY2NvdW50KGZ1bGNydW0uYXJncy5vcmcpO1xuXG4gICAgaWYgKGFjY291bnQpIHtcbiAgICAgIGNvbnN0IGZvcm1zID0gYXdhaXQgYWNjb3VudC5maW5kQWN0aXZlRm9ybXMoe30pO1xuXG4gICAgICBmb3IgKGNvbnN0IGZvcm0gb2YgZm9ybXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdVbmFibGUgdG8gZmluZCBhY2NvdW50JywgZnVsY3J1bS5hcmdzLm9yZyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGUoKSB7XG4gICAgY29uc3QgZGVmYXVsdERhdGFiYXNlT3B0aW9ucyA9IHtcbiAgICAgIHdhbDogdHJ1ZSxcbiAgICAgIGF1dG9WYWN1dW06IHRydWUsXG4gICAgICBzeW5jaHJvbm91czogJ29mZidcbiAgICB9O1xuXG4gICAgZnVsY3J1bS5ta2RpcnAoJ2dlb3BhY2thZ2UnKTtcblxuICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICBmaWxlOiBwYXRoLmpvaW4oZnVsY3J1bS5kaXIoJ2dlb3BhY2thZ2UnKSwgZnVsY3J1bS5hcmdzLm9yZyArICcuZ3BrZycpXG4gICAgfTtcblxuICAgIHRoaXMuZGIgPSBhd2FpdCBTUUxpdGUub3Blbih7Li4uZGVmYXVsdERhdGFiYXNlT3B0aW9ucywgLi4ub3B0aW9uc30pO1xuXG4gICAgYXdhaXQgdGhpcy5lbmFibGVTcGF0aWFMaXRlKHRoaXMuZGIpO1xuXG4gICAgZnVsY3J1bS5vbignZm9ybTpzYXZlJywgdGhpcy5vbkZvcm1TYXZlKTtcbiAgICBmdWxjcnVtLm9uKCdyZWNvcmRzOmZpbmlzaCcsIHRoaXMub25SZWNvcmRzRmluaXNoZWQpO1xuICB9XG5cbiAgYXN5bmMgZGVhY3RpdmF0ZSgpIHtcbiAgICBpZiAodGhpcy5kYikge1xuICAgICAgYXdhaXQgdGhpcy5kYi5jbG9zZSgpO1xuICAgIH1cbiAgfVxuXG4gIHJ1biA9IChzcWwpID0+IHtcbiAgICBzcWwgPSBzcWwucmVwbGFjZSgvXFwwL2csICcnKTtcblxuICAgIHJldHVybiB0aGlzLmRiLmV4ZWN1dGUoc3FsKTtcbiAgfVxuXG4gIG9uRm9ybVNhdmUgPSBhc3luYyAoe2Zvcm0sIGFjY291bnQsIG9sZEZvcm0sIG5ld0Zvcm19KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgb25SZWNvcmRzRmluaXNoZWQgPSBhc3luYyAoe2Zvcm0sIGFjY291bnR9KSA9PiB7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVGb3JtKGZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlUmVjb3JkID0gYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShyZWNvcmQuZm9ybSwgYWNjb3VudCk7XG4gIH1cblxuICB1cGRhdGVGb3JtID0gYXN5bmMgKGZvcm0sIGFjY291bnQpID0+IHtcbiAgICBjb25zdCByYXdQYXRoID0gcGF0aC5qb2luKGZ1bGNydW0uZGlyKCdkYXRhJyksICdmdWxjcnVtLmRiJyk7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihgQVRUQUNIIERBVEFCQVNFICcke3Jhd1BhdGh9JyBhcyAnYXBwJ2ApO1xuXG4gICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZShmb3JtLm5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9X3ZpZXdfZnVsbGAsIG51bGwpO1xuXG4gICAgZm9yIChjb25zdCByZXBlYXRhYmxlIG9mIGZvcm0uZWxlbWVudHNPZlR5cGUoJ1JlcGVhdGFibGUnKSkge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gYCR7Zm9ybS5uYW1lfSAtICR7cmVwZWF0YWJsZS5kYXRhTmFtZX1gO1xuXG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRhYmxlKHRhYmxlTmFtZSwgYGFjY291bnRfJHthY2NvdW50LnJvd0lEfV9mb3JtXyR7Zm9ybS5yb3dJRH1fJHtyZXBlYXRhYmxlLmtleX1fdmlld19mdWxsYCwgcmVwZWF0YWJsZSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW4oYERFVEFDSCBEQVRBQkFTRSAnYXBwJ2ApO1xuICB9XG5cbiAgdXBkYXRlVGFibGUgPSBhc3luYyAodGFibGVOYW1lLCBzb3VyY2VUYWJsZU5hbWUsIHJlcGVhdGFibGUpID0+IHtcbiAgICBjb25zdCB0ZW1wVGFibGVOYW1lID0gc291cmNlVGFibGVOYW1lICsgJ190bXAnO1xuXG4gICAgY29uc3QgZHJvcFRlbXBsYXRlID0gYERST1AgVEFCTEUgSUYgRVhJU1RTICR7dGhpcy5kYi5pZGVudCh0ZW1wVGFibGVOYW1lKX07YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZVRhYmxlID0gYENSRUFURSBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9IEFTIFNFTEVDVCAqIEZST00gYXBwLiR7c291cmNlVGFibGVOYW1lfSBXSEVSRSAxPTA7YDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGNyZWF0ZVRlbXBsYXRlVGFibGUpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5kYi5nZXQoYFNFTEVDVCBzcWwgRlJPTSBzcWxpdGVfbWFzdGVyIFdIRVJFIHRibF9uYW1lID0gJyR7dGVtcFRhYmxlTmFtZX0nYCk7XG4gICAgY29uc3Qge2NvbHVtbnN9ID0gYXdhaXQgdGhpcy5kYi5leGVjdXRlKGBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2ApO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZHJvcFRlbXBsYXRlKTtcblxuICAgIGNvbnN0IGNyZWF0ZSA9IHJlc3VsdC5zcWwucmVwbGFjZSh0ZW1wVGFibGVOYW1lLCB0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKCcoJywgJyAoXFxuX2lkIElOVEVHRVIgUFJJTUFSWSBLRVkgQVVUT0lOQ1JFTUVOVCwgJyk7XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IGNvbHVtbnMubWFwKG8gPT4gdGhpcy5kYi5pZGVudChvLm5hbWUpKTtcblxuICAgIGxldCBvcmRlckJ5ID0gJ09SREVSIEJZIF9yZWNvcmRfaWQnO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgIT0gbnVsbCkge1xuICAgICAgb3JkZXJCeSA9ICdPUkRFUiBCWSBfY2hpbGRfcmVjb3JkX2lkJztcbiAgICB9XG5cbiAgICBjb25zdCBhbGxTUUwgPSBgXG4gICAgICBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX07XG5cbiAgICAgICR7IGNyZWF0ZSB9O1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfY3JlYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIEFERCBfdXBkYXRlZF9ieV9lbWFpbCBURVhUO1xuXG4gICAgICBJTlNFUlQgSU5UTyAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gKCR7Y29sdW1uTmFtZXMuam9pbignLCAnKX0sIF9jcmVhdGVkX2J5X2VtYWlsLCBfdXBkYXRlZF9ieV9lbWFpbClcbiAgICAgIFNFTEVDVCAke2NvbHVtbk5hbWVzLm1hcChvID0+ICd0LicgKyBvKS5qb2luKCcsICcpfSwgbWMuZW1haWwgQVMgX2NyZWF0ZWRfYnlfZW1haWwsIG11LmVtYWlsIEFTIF91cGRhdGVkX2J5X2VtYWlsXG4gICAgICBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gdFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG1jIE9OIHQuX2NyZWF0ZWRfYnlfaWQgPSBtYy51c2VyX3Jlc291cmNlX2lkXG4gICAgICBMRUZUIEpPSU4gbWVtYmVyc2hpcHMgbXUgT04gdC5fdXBkYXRlZF9ieV9pZCA9IG11LnVzZXJfcmVzb3VyY2VfaWRcbiAgICAgICR7b3JkZXJCeX07XG4gICAgYDtcblxuICAgIGF3YWl0IHRoaXMucnVuKGFsbFNRTCk7XG5cbiAgICBpZiAocmVwZWF0YWJsZSA9PSBudWxsKSB7XG4gICAgICBjb25zdCBwYXJlbnRTUUwgPSBgXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX2Fzc2lnbmVkX3RvX2VtYWlsIFRFWFQ7XG5cbiAgICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICAgIEFERCBfcHJvamVjdF9uYW1lIFRFWFQ7XG5cbiAgICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBTRVQgX2Fzc2lnbmVkX3RvX2VtYWlsID0gKFNFTEVDVCBlbWFpbCBGUk9NIGFwcC5tZW1iZXJzaGlwcyBtIFdIRVJFIG0udXNlcl9yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fYXNzaWduZWRfdG9faWQpLFxuICAgICAgICBfcHJvamVjdF9uYW1lID0gKFNFTEVDVCBuYW1lIEZST00gYXBwLnByb2plY3RzIHAgV0hFUkUgcC5yZXNvdXJjZV9pZCA9ICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfS5fcHJvamVjdF9pZCk7XG4gICAgICBgO1xuXG4gICAgICBhd2FpdCB0aGlzLnJ1bihwYXJlbnRTUUwpO1xuICAgIH1cblxuICAgIGNvbnN0IGdlb21TUUwgPSBgXG4gICAgICBERUxFVEUgRlJPTSBncGtnX2dlb21ldHJ5X2NvbHVtbnMgV0hFUkUgdGFibGVfbmFtZT0nJHt0YWJsZU5hbWV9JztcblxuICAgICAgSU5TRVJUIElOVE8gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zXG4gICAgICAodGFibGVfbmFtZSwgY29sdW1uX25hbWUsIGdlb21ldHJ5X3R5cGVfbmFtZSwgc3JzX2lkLCB6LCBtKVxuICAgICAgVkFMVUVTICgnJHt0YWJsZU5hbWV9JywgJ19nZW9tJywgJ1BPSU5UJywgNDMyNiwgMCwgMCk7XG5cbiAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfSBBREQgX2dlb20gQkxPQjtcblxuICAgICAgVVBEQVRFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgU0VUIF9nZW9tID0gZ3BrZ01ha2VQb2ludChfbG9uZ2l0dWRlLCBfbGF0aXR1ZGUsIDQzMjYpO1xuXG4gICAgICBJTlNFUlQgSU5UTyBncGtnX2NvbnRlbnRzICh0YWJsZV9uYW1lLCBkYXRhX3R5cGUsIGlkZW50aWZpZXIsIHNyc19pZClcbiAgICAgIFNFTEVDVCAnJHt0YWJsZU5hbWV9JywgJ2ZlYXR1cmVzJywgJyR7dGFibGVOYW1lfScsIDQzMjZcbiAgICAgIFdIRVJFIE5PVCBFWElTVFMgKFNFTEVDVCAxIEZST00gZ3BrZ19jb250ZW50cyBXSEVSRSB0YWJsZV9uYW1lID0gJyR7dGFibGVOYW1lfScpO1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihnZW9tU1FMKTtcbiAgfVxuXG4gIGFzeW5jIGVuYWJsZVNwYXRpYUxpdGUoZGIpIHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgc3BhdGlhbGl0ZVBhdGggPSBudWxsO1xuXG4gICAgICAvLyB0aGUgZGlmZmVyZW50IHBsYXRmb3JtcyBhbmQgY29uZmlndXJhdGlvbnMgcmVxdWlyZSB2YXJpb3VzIGRpZmZlcmVudCBsb2FkIHBhdGhzIGZvciB0aGUgc2hhcmVkIGxpYnJhcnlcbiAgICAgIGlmIChwcm9jZXNzLmVudi5NT0RfU1BBVElBTElURSkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHByb2Nlc3MuZW52Lk1PRF9TUEFUSUFMSVRFO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCkge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsICdtYWMnLCBwcm9jZXNzLmFyY2gsICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcbiAgICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9ICdtb2Rfc3BhdGlhbGl0ZSc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzcGF0aWFsaXRlUGF0aCA9IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICdtb2Rfc3BhdGlhbGl0ZScpO1xuICAgICAgfVxuXG4gICAgICBkYi5kYXRhYmFzZS5sb2FkRXh0ZW5zaW9uKHNwYXRpYWxpdGVQYXRoLCAoZXJyKSA9PiBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgQ2hlY2tHZW9QYWNrYWdlTWV0YURhdGEoKSBBUyByZXN1bHQnKTtcblxuICAgIGlmIChjaGVja1swXS5yZXN1bHQgIT09IDEpIHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIGdwa2dDcmVhdGVCYXNlVGFibGVzKCknKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBFbmFibGVHcGtnTW9kZSgpIEFTIGVuYWJsZWQsIEdldEdwa2dNb2RlKCkgQVMgbW9kZScpO1xuXG4gICAgaWYgKG1vZGVbMF0ubW9kZSAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmV4cGVjdGVkIGVycm9yIHZlcmlmeWluZyB0aGUgR1BLRyBtb2RlJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcnVuU1FMKHNxbCkge1xuICAgIGxldCByZXN1bHQgPSBudWxsO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuYWxsKHNxbCk7XG4gICAgfSBjYXRjaCAoZXgpIHtcbiAgICAgIHJlc3VsdCA9IHtlcnJvcjogZXgubWVzc2FnZX07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIH1cbn1cbiJdfQ==