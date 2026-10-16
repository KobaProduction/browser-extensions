import type { ClassValue } from 'clsx'
import type { DialogContentProps, PrimitiveProps } from 'reka-ui'
import type {
  DefineComponent,
  HTMLAttributes,
  InjectionKey,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from 'vue'
export interface ButtonVariants {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | null
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | null
}
export declare function buttonVariants(
  props?: ButtonVariants & { class?: ClassValue; className?: ClassValue },
): string
/** Actual shadcn-vue registry controls; Reka aliases preserve their model and event contracts. */
export declare const Button: DefineComponent<
  PrimitiveProps & ButtonVariants & { class?: HTMLAttributes['class'] }
>
export declare const Badge: DefineComponent<{
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  class?: HTMLAttributes['class']
}>
export interface BadgeVariants {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | null
}
export declare function badgeVariants(
  props?: BadgeVariants & { class?: ClassValue; className?: ClassValue },
): string
export declare const Input: DefineComponent<
  InputHTMLAttributes & {
    modelValue?: string | number
    defaultValue?: string | number
    'onUpdate:modelValue'?: (value: string | number) => void
  }
>
export declare const Label: typeof import('reka-ui')['Label']
export declare const Textarea: DefineComponent<
  TextareaHTMLAttributes & {
    modelValue?: string | number
    defaultValue?: string | number
    'onUpdate:modelValue'?: (value: string | number) => void
  }
>
export declare const Checkbox: typeof import('reka-ui')['CheckboxRoot']
export declare const Switch: typeof import('reka-ui')['SwitchRoot']
export declare const Select: typeof import('reka-ui')['SelectRoot']
export declare const SelectContent: typeof import('reka-ui')['SelectContent']
export declare const SelectGroup: typeof import('reka-ui')['SelectGroup']
export declare const SelectItem: typeof import('reka-ui')['SelectItem']
export declare const SelectItemText: typeof import('reka-ui')['SelectItemText']
export declare const SelectLabel: typeof import('reka-ui')['SelectLabel']
export declare const SelectScrollDownButton: typeof import('reka-ui')['SelectScrollDownButton']
export declare const SelectScrollUpButton: typeof import('reka-ui')['SelectScrollUpButton']
export declare const SelectSeparator: typeof import('reka-ui')['SelectSeparator']
export declare const SelectTrigger: typeof import('reka-ui')['SelectTrigger']
export declare const SelectValue: typeof import('reka-ui')['SelectValue']
export declare const Tabs: typeof import('reka-ui')['TabsRoot']
export declare const TabsContent: typeof import('reka-ui')['TabsContent']
export declare const TabsList: typeof import('reka-ui')['TabsList']
export declare const TabsTrigger: typeof import('reka-ui')['TabsTrigger']
export declare const Collapsible: typeof import('reka-ui')['CollapsibleRoot']
export declare const CollapsibleContent: typeof import('reka-ui')['CollapsibleContent']
export declare const CollapsibleTrigger: typeof import('reka-ui')['CollapsibleTrigger']
export declare const Separator: typeof import('reka-ui')['Separator']
export declare const Slider: typeof import('reka-ui')['SliderRoot']
export declare const ScrollArea: typeof import('reka-ui')['ScrollAreaRoot']
export declare const ScrollBar: typeof import('reka-ui')['ScrollAreaScrollbar']
export declare const Progress: typeof import('reka-ui')['ProgressRoot']
export declare const RadioGroup: typeof import('reka-ui')['RadioGroupRoot']
export declare const RadioGroupItem: typeof import('reka-ui')['RadioGroupItem']
export declare const Dialog: typeof import('reka-ui')['DialogRoot']
export declare const DialogClose: typeof import('reka-ui')['DialogClose']
export declare const DialogContent: DefineComponent<
  DialogContentProps & {
    class?: HTMLAttributes['class']
    overlayClass?: HTMLAttributes['class']
    hideCloseButton?: boolean
    portalDisabled?: boolean
    hideOverlay?: boolean
  }
>
export declare const DialogDescription: typeof import('reka-ui')['DialogDescription']
export declare const DialogScrollContent: typeof import('reka-ui')['DialogContent']
export declare const DialogTitle: typeof import('reka-ui')['DialogTitle']
export declare const DialogTrigger: typeof import('reka-ui')['DialogTrigger']
export declare const Tooltip: typeof import('reka-ui')['TooltipRoot']
export declare const TooltipContent: typeof import('reka-ui')['TooltipContent']
export declare const TooltipProvider: typeof import('reka-ui')['TooltipProvider']
export declare const TooltipTrigger: typeof import('reka-ui')['TooltipTrigger']
export declare const Popover: typeof import('reka-ui')['PopoverRoot']
export declare const PopoverContent: typeof import('reka-ui')['PopoverContent']
export declare const PopoverTrigger: typeof import('reka-ui')['PopoverTrigger']
export declare const PopoverAnchor: typeof import('reka-ui')['PopoverAnchor']
type Surface = DefineComponent<{ class?: HTMLAttributes['class'] }>
export declare const Card: Surface
export declare const CardHeader: Surface
export declare const CardTitle: Surface
export declare const CardDescription: Surface
export declare const CardContent: Surface
export declare const CardFooter: Surface
export declare const DialogHeader: Surface
export declare const DialogFooter: Surface
export declare const Table: Surface
export declare const TableHeader: Surface
export declare const TableBody: Surface
export declare const TableFooter: Surface
export declare const TableRow: Surface
export declare const TableHead: Surface
export declare const TableCell: Surface
export declare const TableCaption: Surface
export declare const TableEmpty: DefineComponent<{ colspan?: number; class?: HTMLAttributes['class'] }>
export interface AlertVariants {
  variant?: 'default' | 'destructive' | null
}
export declare function alertVariants(
  props?: AlertVariants & { class?: ClassValue; className?: ClassValue },
): string
export declare const Alert: DefineComponent<AlertVariants & { class?: HTMLAttributes['class'] }>
export declare const AlertTitle: Surface
export declare const AlertDescription: Surface
export declare const Skeleton: Surface
export declare const SettingRow: DefineComponent<{
  id: string
  title: string
  description?: string
  modelValue: boolean
  disabled?: boolean
  flat?: boolean
  class?: HTMLAttributes['class']
  'onUpdate:modelValue'?: (value: boolean) => void
}>
export declare const UI_PORTAL_TARGET: InjectionKey<HTMLElement>
export declare function useUiPortalTarget(): HTMLElement | undefined
export declare const ArchiveProgress: DefineComponent<{
  label: string
  completed?: number | null
  total?: number | null
  detail?: string | null
  error?: string | null
  busy?: boolean
  compact?: boolean
  ariaLabel?: string
}>

export declare const ModalSurface: DefineComponent<{
  label: string
  wide?: boolean
  surfaceClass?: string
  floating?: boolean
  fullscreen?: boolean
  surfaceStyle?: Record<string, string>
}>
export declare const JsonViewer: DefineComponent<{ value: unknown }>
export interface SettingsCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly children?: readonly SettingsCatalogEntry[]
}
export interface SettingsCatalogGroup {
  readonly id: string
  readonly title: string
  readonly entries: readonly SettingsCatalogEntry[]
}
export declare const SettingsCatalog: DefineComponent<{
  groups: readonly SettingsCatalogGroup[]
  selected: string
  label?: string
}>
export interface SiteInjectionTarget {
  readonly id: string
  readonly selectors: readonly string[]
  readonly enabled?: () => boolean
  readonly accepts?: (element: HTMLElement) => boolean
  mount(element: HTMLElement): () => void
}
export interface SiteInjectionSchema {
  readonly targets: readonly SiteInjectionTarget[]
  readonly root?: Document | HTMLElement
  readonly onUnavailable?: (targetId: string) => void
}
export interface SiteInjector {
  refresh(): void
  stop(): void
}
export declare function createSiteInjector(schema: SiteInjectionSchema): SiteInjector
export declare function useLocalizedText(
  messages: Readonly<Record<string, string>>,
): (caption: string) => string
/** Presentation facts only; not evidence of canonical data or request completion. */
export type DomFactValue = boolean | string | number
export type DomFactRoot = Document | HTMLElement
export interface DomFact {
  readonly id: string
  read(root: DomFactRoot): DomFactValue
}
export interface DomFactObserverSchema {
  readonly root: DomFactRoot
  readonly facts: readonly DomFact[]
  readonly attributes?: readonly string[]
  onSnapshot(
    snapshot: ReadonlyMap<string, DomFactValue>,
    changed: readonly string[],
    previous: ReadonlyMap<string, DomFactValue>,
  ): void | Promise<void>
}
export interface DomFactObserver {
  start(): void
  refresh(reset?: boolean): void
  stop(): void
}
export declare function createDomFactObserver(schema: DomFactObserverSchema): DomFactObserver
export declare const FloatingInfoPopover: DefineComponent<{
  label: string
  mode?: 'hover' | 'click' | 'hover-click'
  align?: 'start' | 'end'
  triggerClass?: string
}>
