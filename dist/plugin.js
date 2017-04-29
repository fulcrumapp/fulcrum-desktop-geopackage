'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fulcrumSyncPlugin = require('fulcrum-sync-plugin');

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

      _this3.db = yield _fulcrumSyncPlugin.SQLite.open(_extends({}, defaultDatabaseOptions, options));

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
        const spatialitePath = process.env.DEVELOPMENT ? _path2.default.join('.', 'resources', 'spatialite', 'mac', 'mod_spatialite') : _path2.default.join(_path2.default.dirname(process.execPath), '..', 'Resources', 'spatialite', 'mac', 'mod_spatialite');

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3BsdWdpbi5qcyJdLCJuYW1lcyI6WyJydW5Db21tYW5kIiwiYWN0aXZhdGUiLCJmdWxjcnVtIiwiYXJncyIsInNxbCIsInJ1blNRTCIsImFjY291bnQiLCJmZXRjaEFjY291bnQiLCJvcmciLCJmb3JtcyIsImZpbmRBY3RpdmVGb3JtcyIsImZvcm0iLCJ1cGRhdGVGb3JtIiwiY29uc29sZSIsImVycm9yIiwicnVuIiwicmVwbGFjZSIsImRiIiwiZXhlY3V0ZSIsIm9uRm9ybVNhdmUiLCJvbGRGb3JtIiwibmV3Rm9ybSIsIm9uUmVjb3Jkc0ZpbmlzaGVkIiwidXBkYXRlUmVjb3JkIiwicmVjb3JkIiwicmF3UGF0aCIsImpvaW4iLCJkaXIiLCJ1cGRhdGVUYWJsZSIsIm5hbWUiLCJyb3dJRCIsInJlcGVhdGFibGUiLCJlbGVtZW50c09mVHlwZSIsInRhYmxlTmFtZSIsImRhdGFOYW1lIiwia2V5Iiwic291cmNlVGFibGVOYW1lIiwidGVtcFRhYmxlTmFtZSIsImRyb3BUZW1wbGF0ZSIsImlkZW50IiwiY3JlYXRlVGVtcGxhdGVUYWJsZSIsInJlc3VsdCIsImdldCIsImNvbHVtbnMiLCJjcmVhdGUiLCJjb2x1bW5OYW1lcyIsIm1hcCIsIm8iLCJvcmRlckJ5IiwiYWxsU1FMIiwicGFyZW50U1FMIiwiZ2VvbVNRTCIsInRhc2siLCJjbGkiLCJjb21tYW5kIiwiZGVzYyIsImJ1aWxkZXIiLCJyZXF1aXJlZCIsInR5cGUiLCJoYW5kbGVyIiwiZGVmYXVsdERhdGFiYXNlT3B0aW9ucyIsIndhbCIsImF1dG9WYWN1dW0iLCJzeW5jaHJvbm91cyIsIm1rZGlycCIsIm9wdGlvbnMiLCJmaWxlIiwib3BlbiIsImVuYWJsZVNwYXRpYUxpdGUiLCJvbiIsImRlYWN0aXZhdGUiLCJjbG9zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0Iiwic3BhdGlhbGl0ZVBhdGgiLCJwcm9jZXNzIiwiZW52IiwiREVWRUxPUE1FTlQiLCJkaXJuYW1lIiwiZXhlY1BhdGgiLCJkYXRhYmFzZSIsImxvYWRFeHRlbnNpb24iLCJlcnIiLCJjaGVjayIsImFsbCIsInJvd3MiLCJtb2RlIiwiRXJyb3IiLCJleCIsIm1lc3NhZ2UiLCJsb2ciLCJKU09OIiwic3RyaW5naWZ5Il0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7OztrQkFFZSxNQUFNO0FBQUE7QUFBQTs7QUFBQSxTQWdCbkJBLFVBaEJtQixxQkFnQk4sYUFBWTtBQUN2QixZQUFNLE1BQUtDLFFBQUwsRUFBTjs7QUFFQSxVQUFJQyxRQUFRQyxJQUFSLENBQWFDLEdBQWpCLEVBQXNCO0FBQ3BCLGNBQU0sTUFBS0MsTUFBTCxDQUFZSCxRQUFRQyxJQUFSLENBQWFDLEdBQXpCLENBQU47QUFDQTtBQUNEOztBQUVELFlBQU1FLFVBQVUsTUFBTUosUUFBUUssWUFBUixDQUFxQkwsUUFBUUMsSUFBUixDQUFhSyxHQUFsQyxDQUF0Qjs7QUFFQSxVQUFJRixPQUFKLEVBQWE7QUFDWCxjQUFNRyxRQUFRLE1BQU1ILFFBQVFJLGVBQVIsQ0FBd0IsRUFBeEIsQ0FBcEI7O0FBRUEsYUFBSyxNQUFNQyxJQUFYLElBQW1CRixLQUFuQixFQUEwQjtBQUN4QixnQkFBTSxNQUFLRyxVQUFMLENBQWdCRCxJQUFoQixFQUFzQkwsT0FBdEIsQ0FBTjtBQUNEO0FBQ0YsT0FORCxNQU1PO0FBQ0xPLGdCQUFRQyxLQUFSLENBQWMsd0JBQWQsRUFBd0NaLFFBQVFDLElBQVIsQ0FBYUssR0FBckQ7QUFDRDtBQUNGLEtBbkNrQjs7QUFBQSxTQWdFbkJPLEdBaEVtQixHQWdFWlgsR0FBRCxJQUFTO0FBQ2JBLFlBQU1BLElBQUlZLE9BQUosQ0FBWSxLQUFaLEVBQW1CLEVBQW5CLENBQU47O0FBRUEsYUFBTyxLQUFLQyxFQUFMLENBQVFDLE9BQVIsQ0FBZ0JkLEdBQWhCLENBQVA7QUFDRCxLQXBFa0I7O0FBQUEsU0FzRW5CZSxVQXRFbUI7QUFBQSxvQ0FzRU4sV0FBTyxFQUFDUixJQUFELEVBQU9MLE9BQVAsRUFBZ0JjLE9BQWhCLEVBQXlCQyxP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QUwsQ0FBUW9FLEdBQVIsQ0FBWSwyREFBWixDQUFuQjs7QUFFQSxVQUFJRSxLQUFLLENBQUwsRUFBUUEsSUFBUixLQUFpQixDQUFyQixFQUF3QjtBQUN0QixjQUFNLElBQUlDLEtBQUosQ0FBVSwwQ0FBVixDQUFOO0FBQ0Q7QUFsQndCO0FBbUIxQjs7QUFFS25GLFFBQU4sQ0FBYUQsR0FBYixFQUFrQjtBQUFBOztBQUFBO0FBQ2hCLFVBQUlxQyxTQUFTLElBQWI7O0FBRUEsVUFBSTtBQUNGQSxpQkFBUyxNQUFNLE9BQUt4QixFQUFMLENBQVFvRSxHQUFSLENBQVlqRixHQUFaLENBQWY7QUFDRCxPQUZELENBRUUsT0FBT3FGLEVBQVAsRUFBVztBQUNYaEQsaUJBQVMsRUFBQzNCLE9BQU8yRSxHQUFHQyxPQUFYLEVBQVQ7QUFDRDs7QUFFRDdFLGNBQVE4RSxHQUFSLENBQVlDLEtBQUtDLFNBQUwsQ0FBZXBELE1BQWYsQ0FBWjtBQVRnQjtBQVVqQjtBQXJOa0IsQyIsImZpbGUiOiJwbHVnaW4uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IFNRTGl0ZSB9IGZyb20gJ2Z1bGNydW0nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyB7XG4gIGFzeW5jIHRhc2soY2xpKSB7XG4gICAgcmV0dXJuIGNsaS5jb21tYW5kKHtcbiAgICAgIGNvbW1hbmQ6ICdnZW9wYWNrYWdlJyxcbiAgICAgIGRlc2M6ICdjcmVhdGUgYSBnZW9wYWNrYWdlIGRhdGFiYXNlIGZvciBhbiBvcmdhbml6YXRpb24nLFxuICAgICAgYnVpbGRlcjoge1xuICAgICAgICBvcmc6IHtcbiAgICAgICAgICBkZXNjOiAnb3JnYW5pemF0aW9uIG5hbWUnLFxuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHR5cGU6ICdzdHJpbmcnXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBoYW5kbGVyOiB0aGlzLnJ1bkNvbW1hbmRcbiAgICB9KTtcbiAgfVxuXG4gIHJ1bkNvbW1hbmQgPSBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgdGhpcy5hY3RpdmF0ZSgpO1xuXG4gICAgaWYgKGZ1bGNydW0uYXJncy5zcWwpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuU1FMKGZ1bGNydW0uYXJncy5zcWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBmdWxjcnVtLmZldGNoQWNjb3VudChmdWxjcnVtLmFyZ3Mub3JnKTtcblxuICAgIGlmIChhY2NvdW50KSB7XG4gICAgICBjb25zdCBmb3JtcyA9IGF3YWl0IGFjY291bnQuZmluZEFjdGl2ZUZvcm1zKHt9KTtcblxuICAgICAgZm9yIChjb25zdCBmb3JtIG9mIGZvcm1zKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcignVW5hYmxlIHRvIGZpbmQgYWNjb3VudCcsIGZ1bGNydW0uYXJncy5vcmcpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFjdGl2YXRlKCkge1xuICAgIGNvbnN0IGRlZmF1bHREYXRhYmFzZU9wdGlvbnMgPSB7XG4gICAgICB3YWw6IHRydWUsXG4gICAgICBhdXRvVmFjdXVtOiB0cnVlLFxuICAgICAgc3luY2hyb25vdXM6ICdvZmYnXG4gICAgfTtcblxuICAgIGZ1bGNydW0ubWtkaXJwKCdnZW9wYWNrYWdlJyk7XG5cbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgZmlsZTogcGF0aC5qb2luKGZ1bGNydW0uZGlyKCdnZW9wYWNrYWdlJyksIGZ1bGNydW0uYXJncy5vcmcgKyAnLmdwa2cnKVxuICAgIH07XG5cbiAgICB0aGlzLmRiID0gYXdhaXQgU1FMaXRlLm9wZW4oey4uLmRlZmF1bHREYXRhYmFzZU9wdGlvbnMsIC4uLm9wdGlvbnN9KTtcblxuICAgIGF3YWl0IHRoaXMuZW5hYmxlU3BhdGlhTGl0ZSh0aGlzLmRiKTtcblxuICAgIGZ1bGNydW0ub24oJ2Zvcm06c2F2ZScsIHRoaXMub25Gb3JtU2F2ZSk7XG4gICAgZnVsY3J1bS5vbigncmVjb3JkczpmaW5pc2gnLCB0aGlzLm9uUmVjb3Jkc0ZpbmlzaGVkKTtcbiAgfVxuXG4gIGFzeW5jIGRlYWN0aXZhdGUoKSB7XG4gICAgaWYgKHRoaXMuZGIpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGIuY2xvc2UoKTtcbiAgICB9XG4gIH1cblxuICBydW4gPSAoc3FsKSA9PiB7XG4gICAgc3FsID0gc3FsLnJlcGxhY2UoL1xcMC9nLCAnJyk7XG5cbiAgICByZXR1cm4gdGhpcy5kYi5leGVjdXRlKHNxbCk7XG4gIH1cblxuICBvbkZvcm1TYXZlID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50LCBvbGRGb3JtLCBuZXdGb3JtfSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIG9uUmVjb3Jkc0ZpbmlzaGVkID0gYXN5bmMgKHtmb3JtLCBhY2NvdW50fSkgPT4ge1xuICAgIGF3YWl0IHRoaXMudXBkYXRlRm9ybShmb3JtLCBhY2NvdW50KTtcbiAgfVxuXG4gIHVwZGF0ZVJlY29yZCA9IGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZUZvcm0ocmVjb3JkLmZvcm0sIGFjY291bnQpO1xuICB9XG5cbiAgdXBkYXRlRm9ybSA9IGFzeW5jIChmb3JtLCBhY2NvdW50KSA9PiB7XG4gICAgY29uc3QgcmF3UGF0aCA9IHBhdGguam9pbihmdWxjcnVtLmRpcignZGF0YScpLCAnZnVsY3J1bS5kYicpO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oYEFUVEFDSCBEQVRBQkFTRSAnJHtyYXdQYXRofScgYXMgJ2FwcCdgKTtcblxuICAgIGF3YWl0IHRoaXMudXBkYXRlVGFibGUoZm9ybS5uYW1lLCBgYWNjb3VudF8ke2FjY291bnQucm93SUR9X2Zvcm1fJHtmb3JtLnJvd0lEfV92aWV3X2Z1bGxgLCBudWxsKTtcblxuICAgIGZvciAoY29uc3QgcmVwZWF0YWJsZSBvZiBmb3JtLmVsZW1lbnRzT2ZUeXBlKCdSZXBlYXRhYmxlJykpIHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IGAke2Zvcm0ubmFtZX0gLSAke3JlcGVhdGFibGUuZGF0YU5hbWV9YDtcblxuICAgICAgYXdhaXQgdGhpcy51cGRhdGVUYWJsZSh0YWJsZU5hbWUsIGBhY2NvdW50XyR7YWNjb3VudC5yb3dJRH1fZm9ybV8ke2Zvcm0ucm93SUR9XyR7cmVwZWF0YWJsZS5rZXl9X3ZpZXdfZnVsbGAsIHJlcGVhdGFibGUpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuKGBERVRBQ0ggREFUQUJBU0UgJ2FwcCdgKTtcbiAgfVxuXG4gIHVwZGF0ZVRhYmxlID0gYXN5bmMgKHRhYmxlTmFtZSwgc291cmNlVGFibGVOYW1lLCByZXBlYXRhYmxlKSA9PiB7XG4gICAgY29uc3QgdGVtcFRhYmxlTmFtZSA9IHNvdXJjZVRhYmxlTmFtZSArICdfdG1wJztcblxuICAgIGNvbnN0IGRyb3BUZW1wbGF0ZSA9IGBEUk9QIFRBQkxFIElGIEVYSVNUUyAke3RoaXMuZGIuaWRlbnQodGVtcFRhYmxlTmFtZSl9O2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihkcm9wVGVtcGxhdGUpO1xuXG4gICAgY29uc3QgY3JlYXRlVGVtcGxhdGVUYWJsZSA9IGBDUkVBVEUgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRlbXBUYWJsZU5hbWUpfSBBUyBTRUxFQ1QgKiBGUk9NIGFwcC4ke3NvdXJjZVRhYmxlTmFtZX0gV0hFUkUgMT0wO2A7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihjcmVhdGVUZW1wbGF0ZVRhYmxlKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZGIuZ2V0KGBTRUxFQ1Qgc3FsIEZST00gc3FsaXRlX21hc3RlciBXSEVSRSB0YmxfbmFtZSA9ICcke3RlbXBUYWJsZU5hbWV9J2ApO1xuICAgIGNvbnN0IHtjb2x1bW5zfSA9IGF3YWl0IHRoaXMuZGIuZXhlY3V0ZShgU0VMRUNUICogRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IFdIRVJFIDE9MDtgKTtcblxuICAgIGF3YWl0IHRoaXMucnVuKGRyb3BUZW1wbGF0ZSk7XG5cbiAgICBjb25zdCBjcmVhdGUgPSByZXN1bHQuc3FsLnJlcGxhY2UodGVtcFRhYmxlTmFtZSwgdGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgnKCcsICcgKFxcbl9pZCBJTlRFR0VSIFBSSU1BUlkgS0VZIEFVVE9JTkNSRU1FTlQsICcpO1xuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSBjb2x1bW5zLm1hcChvID0+IHRoaXMuZGIuaWRlbnQoby5uYW1lKSk7XG5cbiAgICBsZXQgb3JkZXJCeSA9ICdPUkRFUiBCWSBfcmVjb3JkX2lkJztcblxuICAgIGlmIChyZXBlYXRhYmxlICE9IG51bGwpIHtcbiAgICAgIG9yZGVyQnkgPSAnT1JERVIgQlkgX2NoaWxkX3JlY29yZF9pZCc7XG4gICAgfVxuXG4gICAgY29uc3QgYWxsU1FMID0gYFxuICAgICAgRFJPUCBUQUJMRSBJRiBFWElTVFMgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9O1xuXG4gICAgICAkeyBjcmVhdGUgfTtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBBREQgX2NyZWF0ZWRfYnlfZW1haWwgVEVYVDtcblxuICAgICAgQUxURVIgVEFCTEUgJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9XG4gICAgICBBREQgX3VwZGF0ZWRfYnlfZW1haWwgVEVYVDtcblxuICAgICAgSU5TRVJUIElOVE8gJHt0aGlzLmRiLmlkZW50KHRhYmxlTmFtZSl9ICgke2NvbHVtbk5hbWVzLmpvaW4oJywgJyl9LCBfY3JlYXRlZF9ieV9lbWFpbCwgX3VwZGF0ZWRfYnlfZW1haWwpXG4gICAgICBTRUxFQ1QgJHtjb2x1bW5OYW1lcy5tYXAobyA9PiAndC4nICsgbykuam9pbignLCAnKX0sIG1jLmVtYWlsIEFTIF9jcmVhdGVkX2J5X2VtYWlsLCBtdS5lbWFpbCBBUyBfdXBkYXRlZF9ieV9lbWFpbFxuICAgICAgRlJPTSBhcHAuJHtzb3VyY2VUYWJsZU5hbWV9IHRcbiAgICAgIExFRlQgSk9JTiBtZW1iZXJzaGlwcyBtYyBPTiB0Ll9jcmVhdGVkX2J5X2lkID0gbWMudXNlcl9yZXNvdXJjZV9pZFxuICAgICAgTEVGVCBKT0lOIG1lbWJlcnNoaXBzIG11IE9OIHQuX3VwZGF0ZWRfYnlfaWQgPSBtdS51c2VyX3Jlc291cmNlX2lkXG4gICAgICAke29yZGVyQnl9O1xuICAgIGA7XG5cbiAgICBhd2FpdCB0aGlzLnJ1bihhbGxTUUwpO1xuXG4gICAgaWYgKHJlcGVhdGFibGUgPT0gbnVsbCkge1xuICAgICAgY29uc3QgcGFyZW50U1FMID0gYFxuICAgICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgQUREIF9hc3NpZ25lZF90b19lbWFpbCBURVhUO1xuXG4gICAgICAgIEFMVEVSIFRBQkxFICR7dGhpcy5kYi5pZGVudCh0YWJsZU5hbWUpfVxuICAgICAgICBBREQgX3Byb2plY3RfbmFtZSBURVhUO1xuXG4gICAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgICAgU0VUIF9hc3NpZ25lZF90b19lbWFpbCA9IChTRUxFQ1QgZW1haWwgRlJPTSBhcHAubWVtYmVyc2hpcHMgbSBXSEVSRSBtLnVzZXJfcmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX2Fzc2lnbmVkX3RvX2lkKSxcbiAgICAgICAgX3Byb2plY3RfbmFtZSA9IChTRUxFQ1QgbmFtZSBGUk9NIGFwcC5wcm9qZWN0cyBwIFdIRVJFIHAucmVzb3VyY2VfaWQgPSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0uX3Byb2plY3RfaWQpO1xuICAgICAgYDtcblxuICAgICAgYXdhaXQgdGhpcy5ydW4ocGFyZW50U1FMKTtcbiAgICB9XG5cbiAgICBjb25zdCBnZW9tU1FMID0gYFxuICAgICAgREVMRVRFIEZST00gZ3BrZ19nZW9tZXRyeV9jb2x1bW5zIFdIRVJFIHRhYmxlX25hbWU9JyR7dGFibGVOYW1lfSc7XG5cbiAgICAgIElOU0VSVCBJTlRPIGdwa2dfZ2VvbWV0cnlfY29sdW1uc1xuICAgICAgKHRhYmxlX25hbWUsIGNvbHVtbl9uYW1lLCBnZW9tZXRyeV90eXBlX25hbWUsIHNyc19pZCwgeiwgbSlcbiAgICAgIFZBTFVFUyAoJyR7dGFibGVOYW1lfScsICdfZ2VvbScsICdQT0lOVCcsIDQzMjYsIDAsIDApO1xuXG4gICAgICBBTFRFUiBUQUJMRSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX0gQUREIF9nZW9tIEJMT0I7XG5cbiAgICAgIFVQREFURSAke3RoaXMuZGIuaWRlbnQodGFibGVOYW1lKX1cbiAgICAgIFNFVCBfZ2VvbSA9IGdwa2dNYWtlUG9pbnQoX2xvbmdpdHVkZSwgX2xhdGl0dWRlLCA0MzI2KTtcblxuICAgICAgSU5TRVJUIElOVE8gZ3BrZ19jb250ZW50cyAodGFibGVfbmFtZSwgZGF0YV90eXBlLCBpZGVudGlmaWVyLCBzcnNfaWQpXG4gICAgICBTRUxFQ1QgJyR7dGFibGVOYW1lfScsICdmZWF0dXJlcycsICcke3RhYmxlTmFtZX0nLCA0MzI2XG4gICAgICBXSEVSRSBOT1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGdwa2dfY29udGVudHMgV0hFUkUgdGFibGVfbmFtZSA9ICcke3RhYmxlTmFtZX0nKTtcbiAgICBgO1xuXG4gICAgYXdhaXQgdGhpcy5ydW4oZ2VvbVNRTCk7XG4gIH1cblxuICBhc3luYyBlbmFibGVTcGF0aWFMaXRlKGRiKSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgc3BhdGlhbGl0ZVBhdGggPSBwcm9jZXNzLmVudi5ERVZFTE9QTUVOVCA/IHBhdGguam9pbignLicsICdyZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsICdtYWMnLCAnbW9kX3NwYXRpYWxpdGUnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IHBhdGguam9pbihwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCksICcuLicsICdSZXNvdXJjZXMnLCAnc3BhdGlhbGl0ZScsICdtYWMnLCAnbW9kX3NwYXRpYWxpdGUnKTtcblxuICAgICAgZGIuZGF0YWJhc2UubG9hZEV4dGVuc2lvbihzcGF0aWFsaXRlUGF0aCwgKGVycikgPT4gZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKCkpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY2hlY2sgPSBhd2FpdCB0aGlzLmRiLmFsbCgnU0VMRUNUIENoZWNrR2VvUGFja2FnZU1ldGFEYXRhKCkgQVMgcmVzdWx0Jyk7XG5cbiAgICBpZiAoY2hlY2tbMF0ucmVzdWx0ICE9PSAxKSB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgdGhpcy5kYi5hbGwoJ1NFTEVDVCBncGtnQ3JlYXRlQmFzZVRhYmxlcygpJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGF3YWl0IHRoaXMuZGIuYWxsKCdTRUxFQ1QgRW5hYmxlR3BrZ01vZGUoKSBBUyBlbmFibGVkLCBHZXRHcGtnTW9kZSgpIEFTIG1vZGUnKTtcblxuICAgIGlmIChtb2RlWzBdLm1vZGUgIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5leHBlY3RlZCBlcnJvciB2ZXJpZnlpbmcgdGhlIEdQS0cgbW9kZScpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJ1blNRTChzcWwpIHtcbiAgICBsZXQgcmVzdWx0ID0gbnVsbDtcblxuICAgIHRyeSB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmRiLmFsbChzcWwpO1xuICAgIH0gY2F0Y2ggKGV4KSB7XG4gICAgICByZXN1bHQgPSB7ZXJyb3I6IGV4Lm1lc3NhZ2V9O1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xuICB9XG59XG4iXX0=