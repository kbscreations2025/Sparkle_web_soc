"use client";

import { motion } from "framer-motion";
import { Wand2, Leaf, Film, Type, PenTool, Scissors, ScanText, Newspaper, MessageSquare, Gem, Package } from "lucide-react";
import { ToolCard, type ToolCardData } from "@/components/ToolCard";

const TOOLS: ToolCardData[] = [
  { icon: Wand2, title: "Cleaning", description: "Remove distractions, studio-grade results", image: "/dashboard/cleaning.png" },
  { icon: Leaf, title: "Life Style", description: "Consistent character across all renders", image: "/dashboard/lyfestyle.png" },
  { icon: Film, title: "Image to Video", description: "Animate stills into cinematic loops", image: "/dashboard/video.png" },
  { icon: Type, title: "Text to Image", description: "Describe it, AI renders it", image: "/dashboard/image.png" },
  { icon: PenTool, title: "Text to Sketch", description: "Describe it, AI sketches it", image: "/dashboard/sketch2.png" },
  { icon: Wand2, title: "Sketch to Image", description: "Upload a sketch, AI renders it", image: "/dashboard/image2.png" },
  { icon: ScanText, title: "Image to Text", description: "Upload an image, AI describes it", image: "/dashboard/image3.jpg" },
  { icon: Scissors, title: "Image to Sketch", description: "Upload an image, AI sketches it", image: "/dashboard/sketch.png" },
  { icon: Newspaper, title: "Marketing Kit", description: "PDF + images, descriptions, specs & captions", image: "/dashboard/marketkit.png" },
  { icon: MessageSquare, title: "Chat to Edit", description: "Iteratively refine a jewellery image, one message at a time", image: "/dashboard/chatToEdit.png" },
  { icon: Gem, title: "Virtual Try On", description: "See jewellery on a model instantly", comingSoon: true },
  { icon: Package, title: "Product Background", description: "Swap backgrounds to any scene", comingSoon: true },
];

// Kept brisk on purpose: with a dozen cards, a slower stagger means the last one
// is still arriving most of a second after the page is otherwise ready.
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

/** Cards in the first row are above the fold — load them eagerly for a faster paint. */
const EAGER_CARD_COUNT = 3;

export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map((tool, index) => (
            <motion.div key={tool.title} variants={cardVariants}>
              <ToolCard {...tool} priority={index < EAGER_CARD_COUNT} />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
