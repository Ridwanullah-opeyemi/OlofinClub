import jwt from "jsonwebtoken";

export const verifyAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "Authentication failure." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Contains id, username, and role_tier

    // Allow entry to any registered administrative executive tier
    const allowedTiers = ["admin", "chief", "senator", "main_admin"];
    if (!allowedTiers.includes(req.user.role_tier)) {
      return res.status(403).json({ success: false, message: "Access Denied: Administrative Clearance Required." });
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Session session expired." });
  }
};

// Strict check middleware endpoint wrapper dedicated exclusively to the Primary Founder actions
export const verifyMainAdmin = (req, res, next) => {
  verifyAdmin(req, res, () => {
    if (req.user.role_tier !== "main_admin") {
      return res.status(432).json({ success: false, message: "Critical Security Exception: Action restricted solely to Platform Owner." });
    }
    next();
  });
};