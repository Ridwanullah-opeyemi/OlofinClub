import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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
// 🎯 ADDED: Imported 'getPendingLoanRequests' from your loans controller
import { 
  getPendingLoanRequests, 
  getPendingRepayments, 
  handleDirectAdminRepayment, 
  requestLoan, 
  resolveLoanRepayment, 
  resolveLoanRequest, 
  submitLoanRepayment 
} from "./controllers/loans.js";

dotenv.config();

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

// ==========================================================================
// 📩 NEW: MEMBERSHIP REQUEST & VETTING ROUTE CHANNELS
// ==========================================================================
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
// Member Borrow Interoperability Operations
app.post("/api/user/loans/request", verifyUser, requestLoan);
app.post("/api/user/loans/repay", verifyUser, submitLoanRepayment); 

// Administrative Oversight Channels
app.post("/api/auth/loans/:requestId/resolve", verifyAdmin, resolveLoanRequest);
app.get("/api/auth/loans/repayments/pending", verifyAdmin, getPendingRepayments); 
app.post("/api/auth/loans/repayments/:repaymentId/resolve", verifyAdmin, resolveLoanRepayment);
app.put("/api/auth/loans/repay-direct/:id", verifyAdmin, handleDirectAdminRepayment);

// 🎯 FIXED: Added the missing route your frontend dashboard needs to read pending loans!
app.get("/api/auth/loans/pending", verifyAdmin, getPendingLoanRequests);

// ==========================================================================
// 🌐 PUBLIC SECURITY PORTAL DOORWAYS
// ==========================================================================
app.post("/api/auth/login", loginUser);
app.post("/api/auth/logout", verifyUser, logoutUser);

// ==========================================================================
// 🚀 ENGINE BOOTSTRAP INITIALIZATION
// ==========================================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[SYSTEM] WealthBridge Server active on network port: ${PORT}`);
});