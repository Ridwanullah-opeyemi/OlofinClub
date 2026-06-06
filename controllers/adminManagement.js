import bcrypt from "bcrypt";
import supabase from "../config/db.js"; // 🎯 FIXED: Imported as default module instance
import { sendSystemEmail } from "./mailController.js";

// 1. Handle incoming public submissions from landing page
export const postMembershipRequest = async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;
    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("membership_requests")
      .insert([{ username, email, phone, password_hash, status: "pending" }]);

    if (error) return res.status(400).json({ success: false, message: "Email parameter registry index already exists." });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 2. Fetch all pending applications for Admin Review
export const getPendingRequests = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("membership_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 3. Process Decision Routing (Approve / Decline) WITH UNIFIED EMAIL SYSTEM
export const resolveMembershipRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action, declineReason } = req.body;

    // Fetch original request details
    const { data: request, error: fetchErr } = await supabase
      .from("membership_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchErr || !request) return res.status(404).json({ success: false, message: "Request missing." });

    // Scenario A: Request is Declined
    if (action === "declined") {
      await supabase
        .from("membership_requests")
        .update({ status: "declined", decline_reason: declineReason })
        .eq("id", requestId);

      return res.status(200).json({ success: true, message: "Application entry explicitly declined with reason context logged." });
    }

    // Scenario B: Request is Approved
    if (action === "approved") {
      // 1. Create actual functional platform contributor row inside main users directory
      const { error: userCreateErr } = await supabase.from("users").insert([
        {
          username: request.username,
          email: request.email,
          phone: request.phone,
          password: request.password_hash,
          amount_paid: 0,
          role_tier: "member"
        }
      ]);

      if (userCreateErr) {
        return res.status(400).json({ success: false, message: "Failed to populate user profile.", error: userCreateErr.message });
      }

      // 2. 🎯 DISPATCH ONBOARDING EMAIL FOR OLOFIN HERITAGE CLUB
      const emailTemplate = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                  <h2 style="color: #2ecc71;">🎉 Welcome to Olofin Heritage Club!</h2>
                  <p>Hello <strong>${request.username}</strong>,</p>
                  <p>We are excited to inform you that the administration panel has reviewed and <strong>approved</strong> your membership request!</p>
                  <p>You can now log into your personal profile dashboard space, start your monthly contributions, and participate in our active funding channels.</p>
                  <div style="margin: 25px 0; text-align: center;">
                  <a href="http://localhost:3000/login" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Click Here to Login</a>
                 </div>
                    <p style="color: #7f8c8d; font-size: 12px;">If the button above does not work, copy and paste this link into your browser: http://localhost:3000/login</p>
                 <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
                  <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club Framework © 2026</p>
              </div>
              `;

      // Updated the sender name metadata cleanly here as well
      await sendSystemEmail(request.email, "Membership Application Approved! 👑", emailTemplate);

      // 3. Clean request item out from panel database table safely
      await supabase.from("membership_requests").delete().eq("id", requestId);

      return res.status(200).json({ success: true, message: "Account profile provisioned into system registry pool and validation mail sent!" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 4. Update Contributor Role Tiers (MAIN_ADMIN EXCLUSIVE RIGHT)
export const alterUserRoleTier = async (req, res) => {
  try {
    const { userId } = req.params;
    const { targetRole } = req.body;

    // Prevent altering the main operational founder flag anchor
    const { data: targetUser } = await supabase.from("users").select("is_primary_founder").eq("id", userId).single();
    if (targetUser?.is_primary_founder) {
      return res.status(403).json({ success: false, message: "System Security Breach: The primary system founder account role tier is immutable." });
    }

    const { error } = await supabase
      .from("users")
      .update({ role_tier: targetRole })
      .eq("id", userId);

    if (error) throw error;
    return res.status(200).json({ success: true, message: `Profile permissions level reallocated to ${targetRole}.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};