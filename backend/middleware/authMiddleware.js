const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const rawAuth = req.headers.authorization;
  if (!rawAuth) return res.status(401).json({ message: "Unauthorized" });

  const token = rawAuth.startsWith("Bearer ") ? rawAuth.split(" ")[1] : rawAuth;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userRole = decoded.role || "user";
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};
