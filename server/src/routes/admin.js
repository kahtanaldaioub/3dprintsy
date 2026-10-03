import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getOctoPrintStatus } from "../services/octoprint.js";

export function adminRouter(printers) {
  const router = Router();

  router.use(authenticate, requireAdmin);

  router.get("/printers", async (_request, response) => {
    const results = await Promise.all(
      printers.map(async (printer) => {
        try {
          return await getOctoPrintStatus(printer);
        } catch (error) {
          console.error(`OctoPrint status check failed for printer "${printer.id}": ${error.message}`);
          return {
            id: printer.id,
            name: printer.name,
            online: false,
            error: "Unable to reach this printer. Check that it is powered on and connected."
          };
        }
      })
    );
    response.json({ printers: results, checkedAt: new Date().toISOString() });
  });

  return router;
}
