import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Alpha",
  description: "Your WhatsApp chats, mirrored and archived.",
  // "Add to Home Screen" on iPhone opens it full screen, like an app
  appleWebApp: { capable: true, title: "Project Alpha", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // draw under the notch / home indicator; the app pads itself with the safe-area insets
  viewportFit: "cover",
  // browsers that support it shrink the layout when the keyboard opens (iOS is handled in ChatApp)
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f2f5" },
    { media: "(prefers-color-scheme: dark)", color: "#111b21" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
