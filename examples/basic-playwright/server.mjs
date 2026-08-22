import { createServer } from "node:http";

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>PrivacySpec example</title></head>
  <body>
    <form id="profile-form">
      <label>Email <input name="email" type="email" autocomplete="email" required></label>
      <button type="submit">Save profile</button>
    </form>
    <p id="status" role="status"></p>
    <script>
      document.querySelector("#profile-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get("email");
        const response = await fetch("/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const result = await response.json();
        if (response.ok && result.saved) document.querySelector("#status").textContent = "Profile saved";
      });
    </script>
  </body>
</html>`;

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method === "POST" && request.url === "/profile") {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"saved":true}');
    });
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(4173, "127.0.0.1");

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
