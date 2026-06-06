import express from "express";

import { alterUserRoleTier, getPendingRequests, postMembershipRequest, resolveMembershipRequest } from "../controllers/adminManagement.js";
import { verifyAdmin, verifyMainAdmin } from "../middleware/authMiddleware.js";

const router = express.Router(); // 🔥 This defines the 'router' variable cleanly!

// Public landing page endpoint
router.post("/membership-request", postMembershipRequest);

// Administrative vetting endpoints
router.get("/membership-requests/pending", verifyAdmin, getPendingRequests);
router.post("/membership-requests/:requestId/resolve", verifyAdmin, resolveMembershipRequest);

// Root owner role alteration endpoint
router.put("/users/:userId/alter-role", verifyMainAdmin, alterUserRoleTier);

export default router;