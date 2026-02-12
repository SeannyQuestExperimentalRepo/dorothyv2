import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials.email as string)?.toLowerCase().trim();
        const password = credentials.password as string;

        if (!password) return null;

        // Admin password grants full ADMIN access
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (adminPassword && password.trim() === adminPassword.trim()) {
          try {
            let adminUser = await prisma.user.findUnique({
              where: { email: "admin@trendline.app" },
            });
            if (!adminUser) {
              adminUser = await prisma.user.create({
                data: { email: "admin@trendline.app", name: "Admin", role: "ADMIN" },
              });
            } else if (adminUser.role !== "ADMIN") {
              adminUser = await prisma.user.update({
                where: { id: adminUser.id },
                data: { role: "ADMIN" },
              });
            }
            return {
              id: adminUser.id,
              email: adminUser.email,
              name: adminUser.name,
              image: adminUser.image,
              role: adminUser.role,
            };
          } catch (err) {
            console.error("[auth] Admin login DB error:", err);
            return null;
          }
        }

        if (!email) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      // Refresh role from DB every 5 minutes to pick up role changes
      const now = Math.floor(Date.now() / 1000);
      if (!token.roleRefreshedAt || now - (token.roleRefreshedAt as number) > 300) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true },
          });
          if (dbUser) {
            token.role = dbUser.role;
          }
          token.roleRefreshedAt = now;
        } catch {
          // DB error is non-fatal — keep existing role
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as UserRole) ?? "FREE";
      }
      return session;
    },
  },
});
