# Next.js Integration

## App Router Setup

shadcn/ui works seamlessly with Next.js App Router.

### Project Structure

```
my-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   └── ui/
│       ├── button.tsx
│       ├── input.tsx
│       └── ...
├── lib/
│   └── utils.ts
├── tailwind.config.js
└── tsconfig.json
```

### Root Layout

```tsx
// app/layout.tsx
import { Inter } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
```

## Server vs Client Components

### Server Components (Default)

Most UI components can be used in Server Components:

```tsx
// app/page.tsx (Server Component)
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
      </CardHeader>
      <CardContent>
        <Button>Click me</Button>
      </CardContent>
    </Card>
  )
}
```

### Client Components

Interactive components that use hooks or event handlers need `"use client"`:

```tsx
// components/login-form.tsx
"use client"

import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"

export function LoginForm() {
  const form = useForm()

  return (
    <form onSubmit={form.handleSubmit(console.log)}>
      <Button type="submit">Login</Button>
    </form>
  )
}
```

Then import in Server Component:

```tsx
// app/page.tsx
import { LoginForm } from "@/components/login-form"

export default function Page() {
  return <LoginForm />
}
```

### When to Use "use client"

Add `"use client"` directive when:
- Using React hooks (useState, useEffect, useForm, etc.)
- Using event handlers (onClick, onChange, etc.)
- Using browser APIs (localStorage, window, etc.)
- Using interactive Radix UI primitives

## Dark Mode

### Setup

```bash
npm install next-themes
```

### Theme Provider

```tsx
// components/theme-provider.tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { type ThemeProviderProps } from "next-themes/dist/types"

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

### Update Root Layout

```tsx
// app/layout.tsx
import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### Theme Toggle Component

```tsx
// components/theme-toggle.tsx
"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "next-themes"

export function ThemeToggle() {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

## Metadata and SEO

### Static Metadata

```tsx
// app/page.tsx
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "My App",
  description: "A Next.js app with shadcn/ui",
}

export default function Page() {
  return <div>Home</div>
}
```

### Dynamic Metadata

```tsx
// app/posts/[id]/page.tsx
import { Metadata } from "next"

export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPost(params.id)
  return {
    title: post.title,
    description: post.excerpt,
  }
}

export default function PostPage({ params }) {
  return <Post id={params.id} />
}
```

## Loading States

### Loading UI

```tsx
// app/loading.tsx
import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  )
}
```

### Skeleton Loading

```tsx
// app/posts/loading.tsx
import { Skeleton } from "@/components/ui/skeleton"

export default function PostsLoading() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  )
}
```

## Error Handling

### Error Boundary

```tsx
// app/error.tsx
"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
      <h2>Something went wrong!</h2>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
```

## API Routes

### Route Handlers

```tsx
// app/api/users/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  const users = await getUsers()
  return NextResponse.json(users)
}

export async function POST(request: Request) {
  const body = await request.json()
  const user = await createUser(body)
  return NextResponse.json(user, { status: 201 })
}
```

## Best Practices

1. **Use Server Components by default** for better performance
2. **Add "use client" only when necessary** (hooks, event handlers)
3. **Place Toaster in root layout** once
4. **Use suppressHydrationWarning** on html tag for dark mode
5. **Leverage loading.tsx** for loading states
6. **Use error.tsx** for error boundaries
7. **Optimize metadata** for SEO
