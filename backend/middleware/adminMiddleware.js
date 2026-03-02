const User = require("../models/user");

module.exports = async (req, res, next) => {
  try {
    if (req.userRole === "admin") {
      return next();
    }

    const user = await User.findById(req.userId).select("role");
    if (user?.role === "admin") {
      req.userRole = "admin";
      return next();
    }

    return res.status(403).json({ message: "Admin access required" });
  } catch (error) {
    return res.status(500).json({ message: "Authorization check failed" });
  }
};
