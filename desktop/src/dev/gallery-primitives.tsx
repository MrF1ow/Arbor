import {
  BookOpenIcon,
  BrainIcon,
  FileTextIcon,
  InfoIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

import { Chip } from "~/components/app/chip";
import { EmptyState } from "~/components/app/empty-state";
import { ListRow } from "~/components/app/list-row";
import { PageHeader } from "~/components/app/page-header";
import { SectionLabel } from "~/components/app/section-label";
import { SettingRow, SettingsSection } from "~/components/app/settings-section";
import { StatusPill } from "~/components/app/status-pill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button, IconButton, type ButtonVariant } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

const BUTTON_VARIANTS: ButtonVariant[] = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "destructive-outline",
  "link",
];
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;

function GallerySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 border-t border-border pt-8">
      <h2 className="mb-4 font-serif text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function GalleryPrimitives() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <>
      <GallerySection title="Buttons">
        <div className="space-y-6">
          {BUTTON_VARIANTS.map((variant) => (
            <div key={variant}>
              <p className="mb-2 font-mono text-2xs text-faint-foreground">{variant}</p>
              <div className="flex flex-wrap items-center gap-2">
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    Update
                  </Button>
                ))}
                <Button variant={variant} size="default" disabled>
                  Disabled
                </Button>
                <Button variant={variant} size="default" aria-pressed>
                  Pressed
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex [&_svg]:outline [&_svg]:outline-1 [&_svg]:outline-border">
              <IconButton icon={PlusIcon} label="Add card" size="icon-xs" />
            </span>
            <span className="inline-flex [&_svg]:outline [&_svg]:outline-1 [&_svg]:outline-border">
              <IconButton icon={SearchIcon} label="Search library" size="icon-sm" />
            </span>
            <span className="inline-flex [&_svg]:outline [&_svg]:outline-1 [&_svg]:outline-border">
              <IconButton icon={LayersIcon} label="Stack view" size="icon" />
            </span>
            <span className="inline-flex [&_svg]:outline [&_svg]:outline-1 [&_svg]:outline-border">
              <IconButton icon={BrainIcon} label="Concept graph" size="icon-lg" />
            </span>
          </div>
        </div>
      </GallerySection>

      <GallerySection title="Inputs">
        <div className="grid max-w-md gap-4">
          <Field>
            <FieldLabel htmlFor="course">Course</FieldLabel>
            <Input id="course" defaultValue="Intro to ML" />
          </Field>
          <Field>
            <FieldLabel htmlFor="course-disabled">Disabled</FieldLabel>
            <Input id="course-disabled" disabled defaultValue="Archived" />
          </Field>
          <Field data-invalid="true">
            <FieldLabel htmlFor="course-invalid">Invalid</FieldLabel>
            <Input id="course-invalid" aria-invalid defaultValue="" />
            <FieldError>Course name is required.</FieldError>
          </Field>
          <Textarea defaultValue="Check citations before publishing the digest." />
          <div className="flex items-center gap-2">
            <Checkbox id="agree" defaultChecked />
            <Label htmlFor="agree">Include diagrams</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="gallery-notify" defaultChecked />
            <Label htmlFor="gallery-notify" className="text-sm">
              Notify when digest completes
            </Label>
          </div>
          <Select defaultValue="ml">
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Course" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ml">Intro to ML</SelectItem>
              <SelectItem value="stats">Statistics</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </GallerySection>

      <GallerySection title="Tabs">
        <Tabs defaultValue="notes" className="mb-6">
          <TabsList variant="underline">
            <TabsTrigger value="notes">
              <FileTextIcon />
              Notes
            </TabsTrigger>
            <TabsTrigger value="flashcards">
              <BookOpenIcon />
              Flashcards
            </TabsTrigger>
          </TabsList>
          <TabsContent value="notes" className="pt-3 text-sm text-muted-foreground">
            Underline tabs for study modes.
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="a">
          <TabsList variant="segmented">
            <TabsTrigger value="a">Week 1</TabsTrigger>
            <TabsTrigger value="b">Week 2</TabsTrigger>
          </TabsList>
        </Tabs>
      </GallerySection>

      <GallerySection title="Badges and kbd">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Accent</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Synced</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="info">Indexing</Badge>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>B</Kbd>
          </KbdGroup>
        </div>
      </GallerySection>

      <GallerySection title="Tooltip">
        <Tooltip defaultOpen>
          <TooltipTrigger render={<Button variant="outline" />}>Hover target</TooltipTrigger>
          <TooltipContent>Toggle sidebar</TooltipContent>
        </Tooltip>
      </GallerySection>

      <GallerySection title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
            <DialogContent>
              <DialogTitle>Update knowledge</DialogTitle>
              <p className="text-sm text-muted-foreground">Rebuild embeddings for this course.</p>
              <div className="flex items-center gap-2">
                <Select defaultValue="full">
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full rebuild</SelectItem>
                    <SelectItem value="incremental">Incremental</SelectItem>
                    <SelectItem value="embeddings">Embeddings only</SelectItem>
                  </SelectContent>
                </Select>
                <IconButton icon={InfoIcon} label="Rebuild scope help" variant="ghost" />
              </div>
              <DialogFooter>
                <Button variant="secondary">Cancel</Button>
                <Button>Run job</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive-outline" />}>
              Alert dialog
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete digest?</AlertDialogTitle>
              <AlertDialogDescription>This removes flashcards tied to the digest.</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
            <SheetContent>
              <SheetTitle>Inspector</SheetTitle>
              <p className="p-4 text-sm text-muted-foreground">Job log preview for citation check.</p>
            </SheetContent>
          </Sheet>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" />}>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Check citations</DropdownMenuItem>
              <DropdownMenuItem>Export deck</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </GallerySection>

      <GallerySection title="Toast">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => toast.success("Digest ready")}>Success</Button>
          <Button onClick={() => toast.error("Worker offline")}>Error</Button>
          <Button onClick={() => toast.info("Indexing notes")}>Info</Button>
          <Button
            onClick={() =>
              toast("Citation check finished", {
                action: { label: "View log", onClick: () => {} },
              })
            }
          >
            With action
          </Button>
        </div>
      </GallerySection>

      <GallerySection title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Digest</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Week 3: Transformers</TableCell>
              <TableCell>Ready</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Week 4: Attention</TableCell>
              <TableCell>Queued</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </GallerySection>

      <GallerySection title="Empty, spinner, skeleton">
        <EmptyState
          icon={FileTextIcon}
          title="No digests yet"
          description="Import PDFs to generate your first weekly digest."
          actions={<Button>Add sources</Button>}
        />
        <div className="mt-4 flex items-center gap-4">
          <Spinner />
          <Skeleton className="h-row w-48" />
        </div>
      </GallerySection>

      <GallerySection title="Command">
        <Command className="max-w-md rounded-md border border-border">
          <CommandInput placeholder="Jump to course or digest…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Courses">
              <CommandItem>Intro to ML</CommandItem>
              <CommandItem>Statistics</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </GallerySection>

      <GallerySection title="Sidebar demo">
        <div className="h-64 overflow-hidden rounded-md border border-border">
          <SidebarProvider
            contained
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            className="flex h-full min-h-0"
          >
            <Sidebar collapsible="offcanvas">
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Courses</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>
                          <BookOpenIcon />
                          <span>Intro to ML</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <LayersIcon />
                          <span>Statistics</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              <Button variant="outline" onClick={() => setSidebarOpen((open) => !open)}>
                Toggle sidebar
              </Button>
            </div>
          </SidebarProvider>
        </div>
      </GallerySection>

      <GallerySection title="App composites">
        <SectionLabel action={<IconButton icon={PlusIcon} label="Add topic" size="icon-xs" />}>
          Study queue
        </SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip onClick={() => {}}>Check citations</Chip>
          <Chip variant="plain">Queued</Chip>
        </div>
        <div className="mt-4 max-w-md divide-y divide-border rounded-md border border-border">
          <ListRow title="Week 3 digest" meta="24 cards" active />
          <ListRow title="Attention reading" meta="Oct 12" twoLine />
        </div>
        <div className="mt-6">
          <PageHeader
            title="Intro to ML"
            description="Flashcards and digests for the fall term."
            actions={<Button size="sm">Update knowledge</Button>}
          />
        </div>
        <div className="mt-6 max-w-lg">
          <SettingsSection title="Worker" description="Local automation settings.">
            <SettingRow
              label="Auto-embed"
              description="Watch incoming PDFs."
              control={<Switch defaultChecked />}
            />
            <SettingRow label="OCR" control={<Switch />} />
            <SettingRow label="Course" control={<Input className="w-40" defaultValue="Intro to ML" />} />
          </SettingsSection>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill variant="idle" label="Idle" />
          <StatusPill variant="running" label="Updating" />
          <StatusPill variant="failed" label="Failed" />
          <StatusPill variant="success" label="Ready" />
        </div>
      </GallerySection>
    </>
  );
}
