import type { Metadata } from "next";
import { ThemeRegistry } from "@/theme/ThemeRegistry";

export const metadata: Metadata = {
  title: "Clause for Concern",
  description: "NDA review against a fixed playbook, with verified citations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
