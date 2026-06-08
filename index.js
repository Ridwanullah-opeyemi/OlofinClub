// 🎯 Load env vars FIRST — before any other import reads process.env (e.g. db.js, JWT secret)
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { 
  approveDepositRequest, 
  createDepositRequest, 
  creditUser, 
  debitUser, 
  deleteUser, 
  forgotPassword, 
  getAllTransactions, 
  getAllUsers, 
  getPendingDeposits, 
  loginUser, 
  logoutUser, 
  registerUser, 
  resetPassword, 
  updateProfile 
} from "./controllers/auth.js"; 
import { verifyAdmin, verifyMainAdmin } from "./middleware/authMiddleware.js";
import { verifyUser } from "./middleware/userMiddleware.js";
import { getUserProfile, getUserTransactions } from "./controllers/user.js";
import { getChatHistory, sendMessage } from "./controllers/chat.js";
import { 
  alterUserRoleTier, 
  getPendingRequests, 
  postMembershipRequest, 
  resolveMembershipRequest 
} from "./controllers/adminManagement.js";
import { 
  getPendingLoanRequests, 
  getPendingRepayments, 
  handleDirectAdminRepayment, 
  requestLoan, 
  resolveLoanRepayment, 
  resolveLoanRequest, 
  submitLoanRepayment,
  // getUserLoans,          // 🎯 Added: lets members view their own loan history
} from "./controllers/loans.js";

const PORT = process.env.PORT || 5000;
const app = express();

// Global Middleware Config Stack
app.use(cors());
app.use(express.json({ limit: "50mb" })); 
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Base Landing Route
app.get("/", (req, res) => {
  res.send("WealthBridge Backend running with Controllers...");
});

// ==========================================================================
// 🔑 CORE AUTHENTICATION & MANAGEMENT PORTS (ADMIN CONTROLLED)
// ==========================================================================
app.post("/api/auth/register", verifyAdmin, registerUser);
app.put("/api/auth/users/:id/credit", verifyAdmin, creditUser);
app.put("/api/auth/users/:id/debit", verifyAdmin, debitUser);
app.get("/api/auth/users", verifyAdmin, getAllUsers);
app.delete("/api/auth/users/:id", verifyAdmin, deleteUser);
app.get("/api/auth/transactions", verifyAdmin, getAllTransactions);

// =========================================================================
// 📩 NEW: MEMBERSHIP REQUEST & VETTING ROUTE CHANNELS
// =========================================================================
app.post("/api/auth/membership-request", postMembershipRequest);
app.get("/api/auth/membership-requests/pending", verifyAdmin, getPendingRequests);
app.post("/api/auth/membership-requests/:requestId/resolve", verifyAdmin, resolveMembershipRequest);
app.put("/api/auth/users/:userId/alter-role", verifyMainAdmin, alterUserRoleTier);

// ==========================================================================
// 💰 TRANSACTIONS & CONTRIBUTIONS ESCROW LAYER
// ==========================================================================
app.post("/api/user/deposit-request", verifyUser, createDepositRequest);
app.patch("/api/auth/deposits/:id/approve", verifyAdmin, approveDepositRequest);
app.get("/api/auth/deposits/pending", verifyAdmin, getPendingDeposits);

// ==========================================================================
// 👤 PROTECTED USER PERSONAL SCOPE ENDPOINTS
// ==========================================================================
app.get("/api/user/:id/profile", verifyUser, getUserProfile);
app.get("/api/user/:id/transactions", verifyUser, getUserTransactions);
app.put("/api/user/update-profile", verifyUser, updateProfile);
app.post("/api/auth/forgot-password", forgotPassword);
app.put("/api/auth/reset-password/:token", resetPassword);

// ==========================================================================
// 💬 INTERNAL COMMUNICATION HUB SYSTEMS (CHAT CHANNELS)
// ==========================================================================
app.post("/api/chat/message", verifyUser, sendMessage);
app.get("/api/chat/messages", verifyUser, getChatHistory);
app.post("/api/admin-chat/message", verifyAdmin, sendMessage);
app.get("/api/admin-chat/messages", verifyAdmin, getChatHistory);

// ==========================================================================
// 💸 LOAN SYSTEM CHANNELS & PIPELINES
// ==========================================================================
app.post("/api/user/loans/request", verifyUser, requestLoan);
app.post("/api/user/loans/repay", verifyUser, submitLoanRepayment);
// app.get("/api/user/loans/history", verifyUser, getUserLoans);       // 🎯 Added: member views own loan history

app.post("/api/auth/loans/:requestId/resolve", verifyAdmin, resolveLoanRequest);
app.get("/api/auth/loans/repayments/pending", verifyAdmin, getPendingRepayments); 
app.post("/api/auth/loans/repayments/:repaymentId/resolve", verifyAdmin, resolveLoanRepayment);
app.put("/api/auth/loans/repay-direct/:id", verifyAdmin, handleDirectAdminRepayment);
app.get("/api/auth/loans/pending", verifyAdmin, getPendingLoanRequests);

// ==========================================================================
// 🌐 PUBLIC SECURITY PORTAL DOORWAYS
// ==========================================================================
app.post("/api/auth/login", loginUser);
app.post("/api/auth/logout", verifyUser, logoutUser);

// ==========================================================================
// 🚧 GLOBAL 404 FALLBACK — catches any unmatched route
// ==========================================================================
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ==========================================================================
// 🚀 ENGINE BOOTSTRAP INITIALIZATION
// ==========================================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[SYSTEM] Olofin Club Server active on network port: ${PORT}`);
});