<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-455a-adb2-6e31a0763ed6" />
</div>

# Origin Hardware Architecture Studio

A web app for browsing, editing, and comparing robot hardware architecture data stored in GitHub repositories.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A GitHub Personal Access Token (PAT) with **read access** to the data repository

## Run Locally

1. **Clone the repository**

   ```bash
   git clone https://github.com/Kathan-Patel-07/Origin-Hardware-Architecture-App.git
   cd Origin-Hardware-Architecture-App
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the dev server**

   ```bash
   npm run dev
   ```

4. **Open the app**

   Navigate to [http://localhost:8080](http://localhost:8080) in your browser.

5. **Log in**

   When prompted, enter your GitHub Personal Access Token. The token is only held in memory and is never saved to disk.

   > To create a PAT: GitHub → Settings → Developer settings → Personal access tokens → Generate new token.
   > Required scope: `repo` (read access to `Kathan-Patel-07/Origin-Hardware-Architecture`).

## Features

- **Connections** — view and edit wiring connections per subsystem
- **Catalog** — read-only parts catalog with quantity tracking
- **Assembly Tracker** — per-connection assembly status
- **Compare** — diff connections and catalog between any two branches
- **Guide** — in-app user guide

## Notes

- No API keys or `.env` files are needed — authentication is done via GitHub PAT at runtime.
- The app reads data from the [`Origin-Hardware-Architecture`](https://github.com/Kathan-Patel-07/Origin-Hardware-Architecture) data repository.
