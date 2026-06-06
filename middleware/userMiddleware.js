import jwt from "jsonwebtoken";

export const verifyUser = (req, res, next) => {
  // 1. Grab the token from the request headers
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    // 2. Decode the token using your secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 3. Attach the FULL decoded object (id, email, role, AND username) to req.user
    req.user = decoded; 
    
    next(); // Pass control to the deposit controller
  } catch (error) {
    return res.status(403).json({ success: false, message: "Invalid or expired session token." });
  }
};