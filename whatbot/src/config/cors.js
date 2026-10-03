const allowedOrigins = ["http://localhost:5173", "http://localhost:3000"];

export const corsConfig = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST"],
  maxAge: 86_400,
};
