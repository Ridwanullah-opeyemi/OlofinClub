import bcrypt from "bcrypt";
import supabase from "../config/db.js";
import { sendSystemEmail } from "./mailController.js";

// ==========================================================================
// 1. Handle incoming public membership submissions from landing page
// @route   POST /api/auth/membership-request
// @access  Public
// ==========================================================================
export const postMembershipRequest = async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;

    // --- Input validation ---
    if (!username || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required: username, email, phone, and password.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("membership_requests")
      .insert([{ username, email: sanitizedEmail, phone, password_hash, status: "pending" }])
      .select("id, username, email, phone, status, created_at");

    if (error) {
      // Catch duplicate email uniqueness violation
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "An application with this email address already exists.",
        });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "Membership application submitted successfully. You will be notified once reviewed.",
      data: data[0],
    });
  } catch (err) {
    console.error("[postMembershipRequest] Error:", err.message);
    return res.status(500).json({ success: false, error: "Server error processing your application." });
  }
};

// ==========================================================================
// 2. Fetch all pending applications for Admin Review
// @route   GET /api/auth/membership-requests/pending
// @access  Private/Admin
// ==========================================================================
export const getPendingRequests = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("membership_requests")
      .select("id, created_at, username, email, phone, status")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    console.error("[getPendingRequests] Error:", err.message);
    return res.status(500).json({ success: false, error: "Server error fetching pending requests." });
  }
};

// ==========================================================================
// 3. Process Decision Routing (Approve / Decline)
// @route   POST /api/auth/membership-requests/:requestId/resolve
// @access  Private/Admin
// ==========================================================================
export const resolveMembershipRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action, declineReason } = req.body;

    // --- Validate action early ---
    if (!action || !["approved", "declined"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be either 'approved' or 'declined'.",
      });
    }

    // --- Fetch the original request ---
    const { data: request, error: fetchErr } = await supabase
      .from("membership_requests")
      .select("id, username, email, phone, password_hash, status")
      .eq("id", requestId)
      .single();

    if (fetchErr || !request) {
      return res.status(404).json({ success: false, message: "Membership request not found." });
    }

    // --- Guard: prevent re-processing already resolved requests ---
    if (request.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `This request has already been ${request.status}.`,
      });
    }

    // =========================================================
    // SCENARIO A: Declined
    // =========================================================
    if (action === "declined") {
      if (!declineReason || declineReason.trim() === "") {
        return res.status(400).json({
          success: false,
          message: "A decline reason is required when rejecting an application.",
        });
      }

      const { error: declineErr } = await supabase
        .from("membership_requests")
        .update({ status: "declined", decline_reason: declineReason.trim() })
        .eq("id", requestId);

      if (declineErr) throw declineErr;

      // Notify the applicant of the rejection
      const declineEmailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #e74c3c;">Membership Application Update</h2>
          <p>Hello <strong>${request.username}</strong>,</p>
          <p>Thank you for your interest in the Olofin Heritage Club. After careful review, we regret to inform you that your membership application was not approved at this time.</p>
          <div style="background: #fdf0f0; border-left: 4px solid #e74c3c; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
            <strong>Reason:</strong>
            <p style="margin: 6px 0 0;">${declineReason.trim()}</p>
          </div>
          <p>If you believe this decision was made in error or would like further clarification, please contact the administration team.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
          <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club © 2026</p>
        </div>
      `;

      await sendSystemEmail(
        request.email,
        "Olofin Heritage Club — Membership Application Update",
        declineEmailTemplate
      );

      return res.status(200).json({
        success: true,
        message: "Application declined and applicant has been notified by email.",
      });
    }

    // =========================================================
    // SCENARIO B: Approved
    // =========================================================
    if (action === "approved") {
      // 1. Create the user account — set ALL relevant columns explicitly
      const { error: userCreateErr } = await supabase.from("users").insert([
        {
          username: request.username,
          email: request.email.trim().toLowerCase(), // normalized to match login query
          phone: request.phone,
          password: request.password_hash,           // already bcrypt-hashed from submission
          amount_paid: 0,
          loan_balance: 0,
          is_verified: false,
          role: "member",                            // original role column
          role_tier: "member",                       // new hierarchical column
          is_primary_founder: false,                 // explicit — never rely on DB default for security flags
        },
      ]);

      if (userCreateErr) {
        // Catch duplicate email in users table (edge case: manually registered before approval)
        if (userCreateErr.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "A user account with this email already exists.",
            error: userCreateErr.message,
          });
        }
        return res.status(400).json({
          success: false,
          message: "Failed to create user account.",
          error: userCreateErr.message,
        });
      }

      // 2. Send onboarding approval email
      const approvalEmailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #2ecc71;">🎉 Welcome to Olofin Heritage Club!</h2>
          <p>Hello <strong>${request.username}</strong>,</p>
          <p>We are pleased to inform you that the administration panel has reviewed and <strong>approved</strong> your membership application!</p>
          <p>You can now log in with the email address and password you provided during registration. Once logged in, you can:</p>
          <ul>
            <li>View your personal profile and contribution balance</li>
            <li>Submit monthly contributions</li>
            <li>Participate in active funding channels</li>
          </ul>
          <div style="margin: 25px 0; text-align: center;">
            <a href="https://olofin-heritage-club.vercel.app/login"
               style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              Login to Your Account
            </a>
          </div>
          <p style="color: #7f8c8d; font-size: 12px;">
            If the button above does not work, copy and paste this link into your browser:<br/>
            https://olofin-heritage-club.vercel.app/login
          </p>
          <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
          <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club © 2026</p>
        </div>
      `;

      await sendSystemEmail(
        request.email,
        "Membership Application Approved! 👑 — Olofin Heritage Club",
        approvalEmailTemplate
      );

      // 3. Remove the processed request from the pending table
      await supabase.from("membership_requests").delete().eq("id", requestId);

      return res.status(200).json({
        success: true,
        message: "Member account created and approval email dispatched successfully.",
      });
    }
  } catch (err) {
    console.error("[resolveMembershipRequest] Error:", err.message);
    return res.status(500).json({ success: false, error: "Server error processing membership decision." });
  }
};

// ==========================================================================
// 4. Update Contributor Role Tiers (MAIN_ADMIN EXCLUSIVE)
// @route   PUT /api/auth/users/:userId/alter-role
// @access  Private/MainAdmin
// ==========================================================================
export const alterUserRoleTier = async (req, res) => {
  try {
    const { userId } = req.params;
    const { targetRole } = req.body;

    const validRoles = ["member", "senator", "chief", "admin", "main_admin"];
    if (!targetRole || !validRoles.includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(", ")}.`,
      });
    }

    // Prevent altering the primary founder's role
    const { data: targetUser, error: fetchErr } = await supabase
      .from("users")
      .select("is_primary_founder, username")
      .eq("id", userId)
      .single();

    if (fetchErr || !targetUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (targetUser.is_primary_founder) {
      return res.status(403).json({
        success: false,
        message: "The primary founder account role cannot be modified.",
      });
    }

    const { error: updateErr } = await supabase
      .from("users")
      .update({ role_tier: targetRole })
      .eq("id", userId);

    if (updateErr) throw updateErr;

    return res.status(200).json({
      success: true,
      message: `Role for ${targetUser.username} updated to '${targetRole}' successfully.`,
    });
  } catch (err) {
    console.error("[alterUserRoleTier] Error:", err.message);
    return res.status(500).json({ success: false, error: "Server error updating user role." });
  }
};