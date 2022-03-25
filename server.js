//to support require keyword
import {createRequire} from "module";
import sqlite3 from 'sqlite3';
import {open} from 'sqlite';

const require = createRequire(import.meta.url);

const express = require("express"),
    crypto = require("crypto"),
    https = require('https'),
    fs = require('fs');

const serverListeningPort = 4000,
    allowedClientUrl = 'https://fuportal.difres.ru',
    dbOptions = {
        filename: 'source.db',
        driver: sqlite3.Database
    };

//настройка https
const httpsOptions = {
    cert: fs.readFileSync('./fullchain.pem'),
    key: fs.readFileSync('./privkey.pem')
};

const app = express(),
    jsonParser = express.json();

https.createServer(httpsOptions, app).listen(serverListeningPort, () => {
    console.log("Сервер успешно запущен и доступен для запросов")
});

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
    if (req.body.login == null || req.body.password == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'Не указан логин или пароль'
        }))
        return
    }

    if (req.body.login.replace(/ /g, '').length < 1 || req.body.login.length > 32) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'Неверный формат логина'
        }))
        return
    }

    if (req.body.password.replace(/ /g, '').length < 1 || req.body.password.length > 48) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'Неверный формат пароля'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get('SELECT * FROM users WHERE login = ?', req.body.login).then((user) => {
            if (user == undefined) {
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
                while (sessions.filter((s) => s.session == new_session) != 0) {
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
    if (req.body.session == null) {
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
                patron: user.patron
            }))
            return
        })
    })
})


app.post('/logout', jsonParser, (req, res) => {
    if (req.body.session == null) {
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
            if (user == undefined) {
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
            if (user == undefined) {
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
            if (user == undefined) {
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
        `, req.body.session).then(user => {
            if (user == undefined) {
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
                if (emp.fac_id != user.fac_id && user.fac_id != null) {
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


app.post('/getEmpMarksGroupedChartData', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.id == null || req.body.startDate == null || req.body.endDate == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no filter data provided'
        }))
        return
    }

    if (req.body.startDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad start date option'
        }))
        return
    }

    if (req.body.endDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad end date option'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT fac_id FROM employees
                WHERE id = ?
            `, req.body.id).then((emp) => {
                if (user.fac_id != null && user.fac_id != emp.fac_id) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому сотруднику'
                    }))
                    return
                }

                db.all(`
                    SELECT mark, COUNT(mark)
                    FROM marks
                    WHERE emp_id = ? AND event_date >= ? AND event_date <= ?
                    GROUP BY mark
                `, [req.body.id, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then((marks) => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'Data was sent',
                        marks: marks
                    }))
                    return
                })
            })
        })
    })
})


app.post('/getEmpMarksGroupedBySubjects', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.id == null || req.body.startDate == null || req.body.endDate == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no filter data provided'
        }))
        return
    }

    if (req.body.startDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad start date option'
        }))
        return
    }

    if (req.body.endDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad end date option'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT fac_id FROM employees
                WHERE id = ?
            `, req.body.id).then((emp) => {
                if (user.fac_id != null && user.fac_id != emp.fac_id) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому сотруднику'
                    }))
                    return
                }

                db.all(`
                    SELECT s.id, s.name, COUNT(m.mark)
                    FROM marks m JOIN subjects s ON m.subject_id = s.id
                    WHERE m.emp_id = ? AND m.event_date >= ? AND m.event_date <= ?
                    GROUP BY s.name
                `, [req.body.id, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then((marks) => {

                    db.all(`
                        SELECT mark, COUNT(mark)
                        FROM marks
                        WHERE emp_id = ? AND event_date >= ? AND event_date <= ?
                        GROUP BY mark
                    `, [req.body.id, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then((marks_avg_and_sum) => {
                        res.send(JSON.stringify({
                            status: 'done',
                            details: 'Data was sent',
                            marks: marks,
                            marks_avg_and_sum: marks_avg_and_sum
                        }))
                        return
                    })
                })
            })
        })
    })
})


app.post('/getGroupedSubjectMarksFilteredByEmployee', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.empId == null || req.body.startDate == null || req.body.endDate == null || req.body.subjId == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no full data provided'
        }))
        return
    }

    if (req.body.startDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad start date option'
        }))
        return
    }

    if (req.body.endDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad end date option'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT fac_id FROM employees
                WHERE id = ?
            `, req.body.empId).then((emp) => {
                if (user.fac_id != null && user.fac_id != emp["fac_id"]) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому сотруднику'
                    }))
                    return
                }

                db.all(`
                    SELECT mark, COUNT(mark)
                    FROM marks
                    WHERE emp_id = ? AND subject_id = ? AND event_date >= ? AND event_date <= ?
                    GROUP BY mark
                `, [req.body.empId, req.body.subjId, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then((marks) => {

                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'Data was sent',
                        marks: marks
                    }))
                    return
                })
            })
        })
    })
})


app.post('/getStudentInfo', jsonParser, (req, res) => {
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
            details: 'Не передан параметр студента для отображения'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT s.*, p.name "pname", f.name "fname", d.name "dname", g.name "gname"
                FROM students s
                JOIN profiles p ON p.id = s.prof_id
                JOIN faculties f ON f.id = s.fac_id
                JOIN directions d ON d.id = s.prof_id
                JOIN groups g ON g.id = s.group_id
                WHERE s.id = ?
            `, req.body.id).then(stud => {
                if (stud.fac_id != user.fac_id && user.fac_id != null) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому студенту'
                    }))
                    return
                }

                res.send(JSON.stringify({
                    status: 'done',
                    details: 'was sent',
                    stud: stud
                }))
                return
            })
        })
    })
})


app.post('/getStudentMarksGroupedChartData', jsonParser, (req, res) => {
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
            details: 'no filter data provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT fac_id FROM students
                WHERE id = ?
            `, req.body.id).then((stud) => {
                if (user.fac_id != null && user.fac_id != stud.fac_id) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому студенту'
                    }))
                    return
                }

                db.all(`
                    SELECT mark, COUNT(mark)
                    FROM marks
                    WHERE stud_id = ? AND mark != 0
                    GROUP BY mark
                `, [req.body.id]).then((marks) => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'Data was sent',
                        marks: marks
                    }))
                    return
                })
            })
        })
    })
})


app.post('/getStudentAvgMarksGroupedByHalfyears', jsonParser, (req, res) => {
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
            details: 'no filter data provided'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'Не выполнен вход'
                }))
                return
            }

            db.get(`
                SELECT fac_id FROM students
                WHERE id = ?
            `, req.body.id).then((stud) => {
                if (user.fac_id != null && user.fac_id != stud.fac_id) {
                    res.send(JSON.stringify({
                        status: 'error',
                        details: 'Нет доступа к данным по этому студенту'
                    }))
                    return
                }

                db.all(`
                    SELECT event_date, ROUND(CAST(SUM(mark) AS FLOAT)/COUNT(mark), 2) "avgMark"
                    FROM marks
                    WHERE stud_id = ? AND mark != 0 AND mark != 1
                    GROUP BY event_date
                `, [req.body.id]).then((marks) => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'Data was sent',
                        marks: marks
                    }))
                    return
                })
            })
        })
    })
})


app.post('/getSubjectInfo', jsonParser, (req, res) => {
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
            details: 'no subject id defined'
        }))
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.get(`
                    SELECT name FROM subjects
                    WHERE id = ?
                `, req.body.id).then(subject => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data was sent',
                        name: subject.name
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT id FROM subjects
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
                    //check subject access
                    if (subjects.map(subj => subj.id).indexOf(req.body.id) == -1) {
                        res.send(JSON.stringify({
                            status: 'error',
                            details: 'subject info access error'
                        }))
                        return
                    }
                    db.get(`
                    SELECT name FROM subjects
                    WHERE id = ?
                `, req.body.id).then(subject => {
                        res.send(JSON.stringify({
                            status: 'done',
                            details: 'data was sent',
                            name: subject.name
                        }))
                        return
                    })
                })
            }
        })
    })
})


app.post('/getGroupedSubjectMarks', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.id == null || req.body.startDate == null || req.body.endDate == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no filter options defined'
        }))
    }

    if (req.body.startDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad start date option'
        }))
        return
    }

    if (req.body.endDate.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'bad end date option'
        }))
        return
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.all(`
                    SELECT mark, COUNT(mark)
                    FROM marks
                    WHERE subject_id = ? AND event_date >= ? AND event_date <= ?
                    GROUP BY mark
                `, [req.body.id, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then(marks => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        marks: marks
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT id FROM subjects
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
                    //check subject access
                    if (subjects.map(subj => subj.id).indexOf(req.body.id) == -1) {
                        res.send(JSON.stringify({
                            status: 'error',
                            details: 'subject info access error'
                        }))
                        return
                    }

                    db.all(`
                    SELECT mark, COUNT(mark)
                    FROM marks
                    WHERE subject_id = ? AND event_date >= ? AND event_date <= ?
                    GROUP BY mark
                `, [req.body.id, req.body.startDate + ' 23:59:59', req.body.endDate + ' 23:59:59']).then(marks => {
                        res.send(JSON.stringify({
                            status: 'done',
                            details: 'data is sent',
                            marks: marks
                        }))
                        return
                    })
                })
            }
        })
    })
})


app.post('/getSubjectAcademicPlans', jsonParser, (req, res) => {
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
            details: 'no filter options defined'
        }))
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            if (user.fac_id == null) {
                //rector
                db.all(`
                    SELECT DISTINCT strftime('%m.%Y', m.event_date) "my", m.control_form "cform", f.name, s.stud_form "sform", (CAST(strftime('%Y', m.event_date) AS INTEGER) - s.enroll_year) "ydiff"
                    FROM marks m
                    JOIN students s ON m.stud_id = s.id
                    JOIN faculties f ON f.id = s.fac_id
                    WHERE subject_id = ?
                `, req.body.id).then(plans => {
                    res.send(JSON.stringify({
                        status: 'done',
                        details: 'data is sent',
                        plans: plans
                    }))
                    return
                })
            } else {
                //dean
                db.all(`
                    SELECT id FROM subjects
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
                    //check subject access
                    if (subjects.map(subj => subj.id).indexOf(req.body.id) == -1) {
                        res.send(JSON.stringify({
                            status: 'error',
                            details: 'subject info access error'
                        }))
                        return
                    }

                    //query and sending
                    db.all(`
                    SELECT DISTINCT strftime('%m.%Y', m.event_date) "my", m.control_form "cform", f.name, s.stud_form "sform", (CAST(strftime('%Y', m.event_date) AS INTEGER) - s.enroll_year) "ydiff"
                    FROM marks m
                    JOIN students s ON m.stud_id = s.id
                    JOIN faculties f ON f.id = s.fac_id
                    WHERE subject_id = ?
                `, req.body.id).then(plans => {
                        res.send(JSON.stringify({
                            status: 'done',
                            details: 'data is sent',
                            plans: plans
                        }))
                        return
                    })
                })
            }
        })
    })
})


app.post('/search', jsonParser, (req, res) => {
    if (req.body.session == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no session provided'
        }))
        return
    }

    if (req.body.query == null) {
        res.send(JSON.stringify({
            status: 'error',
            details: 'no user query text defined'
        }))
    }

    open(dbOptions).then((db) => {
        db.get(`
            SELECT * FROM users
            WHERE id = (SELECT user_id FROM sessions WHERE session = ?)
        `, req.body.session).then(user => {
            if (user == undefined) {
                res.send(JSON.stringify({
                    status: 'error',
                    details: 'session is not alive'
                }))
                return
            }

            let searchResult = [];

            //TABLE #1 - ACADEMIC DEGREES
            db.all(`
                SELECT name FROM academic_degrees
            `).then((result) => {
                result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                    searchResult.push({"name": r.name, "desc": "Научная степень"})
                });

                //TABLE #2 - DEPARTMENTS
                db.all(`
                    SELECT name FROM departments
                `).then(result => {
                    result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                        searchResult.push({"name": r.name, "desc": "Департамент"})
                    });

                    //TABLE #3 - DIRECTIONS
                    db.all(`
                        SELECT name FROM directions
                    `).then(result => {
                        result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                            searchResult.push({"name": r.name, "desc": "Направление"})
                        });


                        //TABLE #4 - EDICATION INSTITUTIONS
                        db.all(`
                            SELECT name FROM education_institutions
                        `).then(result => {
                            result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                searchResult.push({"name": r.name, "desc": "Образовательное учреждение"})
                            });

                            //TABLE #5 - EMPLOYEES
                            db.all(`
                                SELECT surname || ' ' || name || ' ' || patron "name"
                                FROM employees
                            `).then(result => {
                                result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                    searchResult.push({"name": r.name, "desc": "Сотрудник"})
                                });

                                //TABLE #6 - FACULTIES
                                db.all(`
                                    SELECT name FROM faculties
                                `).then(result => {
                                    result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                        searchResult.push({"name": r.name, "desc": "Факультет"})
                                    });

                                    //TABLE #7 - GROUPS
                                    db.all(`
                                        SELECT name FROM groups
                                    `).then(result => {
                                        result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                            searchResult.push({"name": r.name, "desc": "Учебная группа"})
                                        });

                                        //TABLE #8 - POSITIONS
                                        db.all(`
                                            SELECT name FROM positions
                                        `).then(result => {
                                            result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                                searchResult.push({"name": r.name, "desc": "Должность"})
                                            });

                                            //TABLE #9 - PROFILES
                                            db.all(`
                                                SELECT name FROM profiles
                                            `).then(result => {
                                                result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                                    searchResult.push({"name": r.name, "desc": "Профиль обучения"})
                                                });

                                                //TABLE #10 - STUDENTS
                                                db.all(`
                                                    SELECT surname || ' ' || name || ' ' || patron "name"
                                                    FROM students
                                                `).then(result => {
                                                    result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                                        searchResult.push({"name": r.name, "desc": "Обучающийся"})
                                                    });

                                                    //TABLE #11 - SUBJECTS
                                                    db.all(`
                                                        SELECT name FROM subjects
                                                    `).then(result => {
                                                        result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                                            searchResult.push({"name": r.name, "desc": "Дисциплина"})
                                                        });

                                                        //TABLE #12 - USERS
                                                        db.all(`
                                                            SELECT surname || ' ' || name || ' ' || patron "name"
                                                            FROM users
                                                        `).then(result => {
                                                            result.filter(r => r.name.toLowerCase().indexOf(req.body.query.toLowerCase()) != -1).forEach((r) => {
                                                                searchResult.push({
                                                                    "name": r.name,
                                                                    "desc": "Пользователь системы"
                                                                })
                                                            });

                                                            res.send({
                                                                status: 'done',
                                                                results: searchResult
                                                            });
                                                            return
                                                        })
                                                    })
                                                })
                                            })
                                        })
                                    })
                                })
                            })
                        })
                    })
                })
            })
        })
    })
})