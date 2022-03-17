//to support require keyword
import {createRequire} from "module";
import sqlite3 from 'sqlite3';
import {open} from 'sqlite';

const require = createRequire(import.meta.url);

const express = require("express"),
    crypto = require("crypto");

const serverListeningPort = 4000,
    allowedClientUrl = 'http://localhost:3000',
    dbOptions = {
        filename: 'source.db',
        driver: sqlite3.Database
    };

const app = express(),
    jsonParser = express.json();

app.listen(serverListeningPort, () => {
})

app.use(jsonParser, (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", allowedClientUrl);
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (['POST', 'GET'].indexOf(req.method) != -1) console.log(`${new Date().toLocaleString()}: ${req.method}-ЗАПРОС. ${req.url} - ${JSON.stringify(req.body)}`)
    next()
})

open(dbOptions).then((db) => {
    //create sessions table, if not exists (for user login)
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        session VARCHAR2(128),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`)
    console.log('Сервер успешно запущен.')
})


//API routes
app.post('/login', jsonParser, (req, res) => {
    if (req.body.login == null || req.body.password == null){
        res.send(JSON.stringify({
            status: 'error',
            details: 'Не указан логин или пароль'
        }))
        return
    }

    if (req.body.login.replace(/ /g, '').length < 1 || req.body.login.length > 32){
        res.send(JSON.stringify({
            status: 'error',
            details: 'Неверный формат логина'
        }))
        return
    }

    if (req.body.password.replace(/ /g, '').length < 1 || req.body.password.length > 48){
        res.send(JSON.stringify({
            status: 'error',
            details: 'Неверный формат пароля'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get('SELECT * FROM users WHERE login = ?', req.body.login).then((user) => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не найден указанный пользователь в системе'
                }))
                return
            }

            if (req.body.password != user.password) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Указан неправильный пароль'
                }))
                return
            }

            db.all('SELECT session FROM sessions').then((sessions) => {
                let new_session = crypto.randomBytes(32).toString('hex');

                //generate unique session key
                while (sessions.filter((s) => s.session == new_session) != 0){
                    new_session = crypto.randomBytes(32).toString('hex');
                }

                db.run('INSERT INTO sessions (user_id, session) VALUES (?, ?)', [user.id, new_session]).then(() => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'Успешный вход в систему',
                        session: new_session
                    }))
                    return
                })
            })
        })
    })
})


app.post('/checkSessionExisting', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get('SELECT * FROM sessions WHERE session = ?', req.body.session).then((session) => {
            if (session == undefined) {
                res.send(JSON.stringify({
                    status: 'done',
                    details: 'outdated'
                }))
                return
            } else {
                res.send(JSON.stringify({
                    status: 'done',
                    details: 'alive'
                }))
                return
            }
        })
    })
})


app.post('/getMoodleName', jsonParser, (req, res) => {
    if (req.body.session == null){
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
        SELECT name, surname, patron FROM users
        WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then((user) => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            res.send(JSON.stringify({
                status: 'done',
                name: user.name,
                surname: user.surname,
                patron: user.patron
            }))
            return
        })
    })
})


app.post('/logout', jsonParser, (req, res) => {
    if (req.body.session == null){
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.run(`
            DELETE FROM sessions WHERE session = ?
        `, req.body.session).then((result) => {
            res.send(JSON.stringify({
                status: 'done'
            }))
            return
        })
    })
})

app.post('/getUserInfo', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT u.name "name", u.surname "surname", u.patron "patron", u.login "login", f.name "fac"
            FROM users u LEFT JOIN faculties f ON u.fac_id = f.id
            WHERE u.id = (SELECT user_id FROM sessions WHERE session = ?) 
        `, req.body.session).then((user) => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }
            res.send(JSON.stringify({
                status: 'done',
                name: user.name,
                surname: user.surname,
                patron: user.patron,
                fac: user.fac,
                login: user.login
            }))
            return
        })
    })
})


app.post('/getAllEmployees', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.all(`
                    SELECT e.id "id", e.name "name", e.surname "surname", e.patron "patron", e.birthdate "birthdate", d.name "dname",  p.name "pname"
                    FROM employees e
                    JOIN departments d ON e.dep_id = d.id
                    JOIN positions p ON e.pos_id = p.id
                `).then(employees => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        employees: employees
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT e.id "id", e.name "name", e.surname "surname", e.patron "patron", e.birthdate "birthdate", d.name "dname",  p.name "pname"
                    FROM employees e
                    JOIN departments d ON e.dep_id = d.id
                    JOIN positions p ON e.pos_id = p.id
                    WHERE e.fac_id = ?
                `, user.fac_id).then(employees => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        employees: employees
                    }))
                    return
                })
            }
        })
    })
})


app.post('/getAllStudents', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.all(`
                    SELECT s.id "id", s.name "name", s.surname "surname", s.patron "patron", s.sex "sex", s.birthdate "birthdate", s.status "status", s.stud_year "stud_year",
                    s.fac_id "fac_id", s.prof_id "prof_id", s.dir_id "dir_id", s.group_id "group_id", s.stud_form "stud_form", s.funding "funding", s.region "region",
                    s.citizenship "citizenship", s.enroll_year "enroll_year", s.email "email", f.name "fac_name", d.name "dir_name", p.name "prof_name"
                    FROM students s
                    JOIN faculties f ON s.fac_id = f.id
                    JOIN directions d ON s.dir_id = d.id
                    JOIN profiles p ON s.prof_id = p.id
                `).then(students => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        students: students
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT s.id "id", s.name "name", s.surname "surname", s.patron "patron", s.sex "sex", s.birthdate "birthdate", s.status "status", s.stud_year "stud_year",
                    s.fac_id "fac_id", s.prof_id "prof_id", s.dir_id "dir_id", s.group_id "group_id", s.stud_form "stud_form", s.funding "funding", s.region "region",
                    s.citizenship "citizenship", s.enroll_year "enroll_year", s.email "email", f.name "fac_name", d.name "dir_name", p.name "prof_name"
                    FROM students s
                    JOIN faculties f ON s.fac_id = f.id
                    JOIN directions d ON s.dir_id = d.id
                    JOIN profiles p ON s.prof_id = p.id
                    WHERE s.fac_id = ?
                `, user.fac_id).then(students => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        students: students
                    }))
                    return
                })
            }
        })
    })
})


app.post('/getAllSubjects', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.all(`
                    SELECT * FROM subjects
                `).then(subjects => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        subjects: subjects
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT * FROM subjects
                    WHERE id IN (
                        SELECT DISTINCT subject_id
                        FROM marks
                        WHERE emp_id IN (
                            SELECT id FROM employees
                            WHERE fac_id = ?
                        )
                        OR stud_id IN (
                            SELECT id FROM students
                            WHERE fac_id = ?
                        )
                    )
                `, [user.fac_id, user.fac_id]).then(subjects => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        subjects: subjects
                    }))
                    return
                })
            }
        })
    })
})


app.post('/getEmployeeInfo', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.id == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'Не передан параметр сотрудника для отображения'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `,req.body.session).then(user => {
            if (user == undefined){
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT e.*, d.name "dname", f.name "fname", p.name "pname", a.name "aname", ei.name "einame"
                FROM employees e
                JOIN departments d ON d.id = e.dep_id
                JOIN faculties f ON f.id = e.fac_id 
                JOIN positions p ON p.id = e.pos_id
                JOIN academic_degrees a ON a.id = e.acad_degree_id
                JOIN education_institutions ei ON ei.id = e.educ_inst_id 
                WHERE e.id = ?
            `, req.body.id).then(emp => {
                if (emp.fac_id != user.fac_id && user.fac_id != null){
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому сотруднику'
                    }))
                    return
                }

                res.send(JSON.stringify({
                    status: 'done',
                    details: 'was sent',
                    emp: emp
                }))
                return
            })
        })
    })
})