import express from "express";
import logger from "morgan";
import { Server } from "socket.io";
import { createServer } from "http";
import dotenv from 'dotenv';
import { createClient } from "@libsql/client";

dotenv.config();

const port = process.env.PORT ?? 3000;

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5174",
    methods: ["GET", "POST"],
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 60000,
  },
});

//La base de dades que tinc amb el turso
const db = createClient({
  url: "libsql://modern-azazel-transloideer.turso.io",
  authToken: process.env.DB_TOKEN,
});

await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        user TEXT
    )
`);

//Primer IO quan el client estableix la connexió cap el servidor un cop dins
//si tot funciona correctament ens mostrarà el cgl Connected
io.on('connection', async (socket) => {
  console.log('Connected!');

  //En el cas que el client tanqui la connexió s'activarà el disconnect i en meu cas
  //també mostro el missatge de disconnected (per portar-ne el control) 
  socket.on('disconnect', () => {
    console.log('Disconnected!');
  });

  //Per quan arribi una petició del client al servidor, aquí dins tractem l'informació 
  //que ens arriba i ja podem gestionar el tema d'inserts a la base de dades etc...
  socket.on('chat message', async (msg) => {
    let result;

    //socket.handshake.auth.username això és per recuperar el que he comentat a 
    //classe que establiem de manera default per a cada client i que aquí ho podiem recuperar
    console.log('userInformation ' + socket.handshake.auth.username);
    console.log('msg ' + msg);
    const username = socket.handshake.auth.username ?? 'anonymous';
    try {
      result = await db.execute({
        sql: `INSERT INTO messages (content, user) VALUES (:msg, :username)`,
        args: { msg, username },
      });
    } catch (error) {
      console.error(error);
      return;
    }

    //Si arribem fins aquí tot el de dalt ha funcionat correctament i simplement emetem
    // el missatge a tots els usuaris que actualment estiguin connectats en el servidor
    //que estiguin escoltant el chat message
    io.emit('chat message', msg, result.lastInsertRowid.toString(), username);
  });

  //Aquí verifiquem que la connexió del client és nova o prové d'una desconnexió alguna cosa similar
  //si aquesta és nova, simplement s'executarà el select i se l'hi mostrarà tota la informació a l'usuari
  if (!socket.recovered) {
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, user FROM messages WHERE id > ?',
        args: [socket.handshake.auth.serverOffset ?? 0],
      });
      results.rows.forEach((row) => {
        socket.emit('chat message', row.content, row.id.toString(), row.user);
      });
    } catch (error) {
      console.error(error);
    }
  }
});

app.use(logger('dev'));

app.all('*', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
