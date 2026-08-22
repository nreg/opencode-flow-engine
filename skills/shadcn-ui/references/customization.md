# Customization

## Component Ownership

Components are copied into your project at `components/ui/`. You own the code and can customize freely.

## CSS Variables Theming

### Default Variables

shadcn/ui uses CSS variables defined in `app/globals.css`:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark mode values */
  }
}
```

### Custom Theme

Modify variables to create custom themes:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --primary: 346 77% 50%;
    --primary-foreground: 0 0% 100%;
    --radius: 0.75rem;
  }
}
```

### Color Format

Colors use HSL format: `H S% L%`

Example conversions:
- Blue: `217 91% 60%`
- Red: `0 84% 60%`
- Green: `142 71% 45%`
- Purple: `270 60% 55%`

## cn() Utility

The `cn()` utility merges Tailwind classes conditionally:

```tsx
// lib/utils.ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Usage:

```tsx
import { cn } from "@/lib/utils"

<div className={cn(
  "base-class",
  isActive && "active-class",
  size === "lg" && "large-class"
)} />
```

## Custom Variants

### Button Variants

Extend button variants in `components/ui/button.tsx`:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Custom variants
        success: "bg-green-500 text-white hover:bg-green-600",
        warning: "bg-yellow-500 text-white hover:bg-yellow-600",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
```

### Custom Component Sizes

```tsx
const cardVariants = cva("rounded-lg border bg-card text-card-foreground shadow-sm", {
  variants: {
    size: {
      default: "",
      sm: "p-4",
      lg: "p-8",
    },
  },
  defaultVariants: {
    size: "default",
  },
})
```

## Extending Components

### Custom Button

```tsx
// components/ui/custom-button.tsx
import { Button, ButtonProps } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface CustomButtonProps extends ButtonProps {
  loading?: boolean
}

export function CustomButton({ loading, children, disabled, ...props }: CustomButtonProps) {
  return (
    <Button disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}
```

### Custom Input

```tsx
// components/ui/custom-input.tsx
import { Input, InputProps } from "@/components/ui/input"
import { forwardRef } from "react"

interface CustomInputProps extends InputProps {
  icon?: React.ReactNode
}

export const CustomInput = forwardRef<HTMLInputElement, CustomInputProps>(
  ({ icon, className, ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {icon}
          </div>
        )}
        <Input
          ref={ref}
          className={cn(icon && "pl-10", className)}
          {...props}
        />
      </div>
    )
  }
)
```

### Custom Card

```tsx
// components/ui/custom-card.tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface CustomCardProps {
  title: string
  description?: string
  content: React.ReactNode
  footer?: React.ReactNode
}

export function CustomCard({ title, description, content, footer }: CustomCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{content}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  )
}
```

## Tailwind Config Extension

### Custom Colors

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
      },
    },
  },
}
```

### Custom Animations

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
}
```

## Best Practices

1. **Modify component files directly** — you own the code
2. **Use CSS variables** for consistent theming
3. **Extend with cn()** for conditional classes
4. **Create custom variants** for reusable patterns
5. **Keep accessibility** when customizing
6. **Test dark mode** after changes
7. **Document custom variants** for team
