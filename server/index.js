import express from "express";
import logger from "morgan";
import { Server } from "socket.io";
import { createServer } from "http"; // Cambié esto para que `http` sea usado directamente
import dotenv from 'dotenv';
import { createClient } from "@libsql/client";

dotenv.config();

const port = process.env.PORT ?? 3000;

const app = express();
const server = createServer(app); // Creamos el servidor HTTP de Express

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5174", // El puerto donde corre Remix durante el desarrollo
    methods: ["GET", "POST"],
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 60000, // 60 segundos para recuperación de estado
  },
});

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

io.on('connection', async (socket) => {
  console.log('Connected!');

  socket.on('disconnect', () => {
    console.log('Disconnected!');
  });

  // Escuchar los mensajes del cliente
  socket.on('chat message', async (msg) => {
    let result;
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

    io.emit('chat message', msg, result.lastInsertRowid.toString(), username);
  });

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

// Servir archivos estáticos de Remix
app.all('*', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html');
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
