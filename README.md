# KD Prints

KD Prints is the first platform milestone from the graduation project plan: a MERN customer workspace for accounts, private model uploads, 3D previews, and print-order tracking.

## Requirements

- Node.js 20 or newer
- MongoDB running locally or a MongoDB connection string

## Run locally

1. Install dependencies from the project root:

   ```sh
   npm install
   ```

2. Copy `server/.env.example` to `server/.env`. Set `MONGO_URI` to your MongoDB instance and replace `JWT_SECRET` with a unique random secret of at least 32 characters.

3. Set up and start the Python analysis service in its own terminal:

   ```powershell
   py -3 -m venv ai-service\.venv
   .\ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
   .\ai-service\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000 --reload
   ```

   If `py -3` selects an unavailable Python installation, use `python -m venv ai-service\.venv` instead. The Python service is private to the local computer by default. Its health endpoint is <http://127.0.0.1:8000/health>.

   To check another printer size, set `PRINTER_BUILD_VOLUME_MM` in that terminal before launching Uvicorn. For example, PowerShell: `$env:PRINTER_BUILD_VOLUME_MM="180,180,180"`. The default assumed build volume is `220,220,250` mm.

4. In another terminal, start the API and the Vite development server:

   ```sh
   npm run dev
   ```

5. Open <http://localhost:5173>, create an account, upload an STL or OBJ file, and select **Check printability**. The API runs at <http://localhost:4000>.

If you use MongoDB Atlas and the API reports a connection error, open **Security → Network Access** in Atlas and add your current public IP address. Also make sure the database user in `MONGO_URI` exists and its password is URL-encoded if it contains reserved URL characters. Do not leave access open to all IP addresses. The API prints a short connection error after 10 seconds when MongoDB cannot be reached.

To point the browser app at a different API origin, set `VITE_API_URL` in the client environment (for example, `http://localhost:4000/api`). The API allows browser requests from `CLIENT_ORIGIN`, which defaults to `http://localhost:5173`.

### OctoPrint status

Add the administrator account email and printer connections to `server/.env`:

```dotenv
ADMIN_EMAILS=admin@example.com
OCTOPRINT_PRINTERS=[{"id":"fdm-1","name":"FDM 1","url":"http://192.168.1.50","apiKey":"YOUR_OCTOPRINT_API_KEY"},{"id":"fdm-2","name":"FDM 2","url":"http://192.168.1.51","apiKey":"YOUR_SECOND_OCTOPRINT_API_KEY"}]
```

Use unique IDs containing letters, numbers, hyphens, or underscores. Each printer URL is its OctoPrint server address; add additional printer objects as needed. Keep these private addresses and API keys in the server environment only—never in client environment variables or source control. Restart the server after editing the configuration. The configured administrator must sign in again to receive the administrator dashboard flag.

The printer dashboard polls every 10 seconds and displays connection state, job progress, and available temperatures. Its read-only endpoint is `GET /api/admin/printers`; a configured `ADMIN_EMAILS` address and a bearer token are required. This milestone does not start, pause, or cancel printer jobs.

Run the printer status unit tests with `npm test -w server`.

Run the printability checker unit tests with:

```powershell
.\ai-service\.venv\Scripts\python.exe -m unittest discover -s ai-service -p "test_*.py" -v
```

## Included in this milestone

- JWT sign-up/sign-in with hashed passwords and authenticated API routes.
- Private STL/OBJ upload (25 MB limit), basic mesh-content checks, and account-scoped file delivery.
- Interactive STL/OBJ preview in Three.js.
- Create/list orders with material, color, quantity, post-processing, and notes; customers may cancel pending orders.
- Administrator-only, read-only OctoPrint status dashboard for configured printers.
- A separate Python/FastAPI service for first-pass STL/OBJ mesh checks, connected to the authenticated model-analysis API.
- Orders are stored for review; the app intentionally does not fabricate a quote before the planned slicing/AI estimator exists.

The first-pass analysis reports mesh closure, face winding, degenerate faces, disconnected components, dimensions/build-volume fit, and potential overhang area for the uploaded orientation. Results are saved with the model. It does not measure local wall thickness, simulate slicing, predict print success, or verify STL/OBJ units. Configure the assumed printer bounds in the Python service environment with `PRINTER_BUILD_VOLUME_MM` (three comma-separated dimensions, defaults to `220,220,250`). Other rule thresholds are configurable with `MAX_OVERHANG_ANGLE_DEGREES` and `MIN_OVERALL_DIMENSION_MM`; the latter flags a small overall bounding-box dimension, not an individual thin wall.

Uploads are stored in `server/uploads` by default and should be backed up or moved to private object storage before deployment. The current milestone does not include payments, trained AI models, admin workflows beyond printer status, or printer dispatch.

## API overview

All routes are prefixed with `/api`.

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Public | Create an account |
| `POST` | `/auth/login` | Public | Sign in |
| `GET` | `/auth/me` | Bearer token | Get the current account |
| `GET` | `/models` | Bearer token | List the current account's models |
| `POST` | `/models` | Bearer token | Upload a model in multipart field `model` |
| `GET` | `/models/:id/file` | Bearer token | Retrieve an owned model for preview |
| `POST` | `/models/:id/analyze` | Bearer token | Analyze an owned model using the Python service |
| `GET` | `/orders` | Bearer token | List the current account's orders |
| `POST` | `/orders` | Bearer token | Request a print |
| `PATCH` | `/orders/:id/cancel` | Bearer token | Cancel a pending order |
