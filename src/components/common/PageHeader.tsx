import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ReactNode, useRef } from "react";

export interface ActionButton {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    className?: string;
    variant?: "primary" | "secondary" | "danger" | "warning";
}

interface PageHeaderProps {
    title?: string;
    onBack?: () => void;
    backLabel?: string;
    actions?: ActionButton[];
    children?: ReactNode;
}

const variantStyles = {
    primary: "bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 dark:from-violet-500 dark:via-purple-500 dark:to-fuchsia-500 hover:from-violet-700 hover:via-purple-700 hover:to-fuchsia-700 dark:hover:from-violet-400 dark:hover:via-purple-400 dark:hover:to-fuchsia-400",
    secondary: "bg-gradient-to-br from-slate-600 via-gray-600 to-zinc-600 dark:from-slate-500 dark:via-gray-500 dark:to-zinc-500 hover:from-slate-700 hover:via-gray-700 hover:to-zinc-700 dark:hover:from-slate-400 dark:hover:via-gray-400 dark:hover:to-zinc-400",
    danger: "bg-gradient-to-br from-rose-600 via-pink-600 to-red-600 dark:from-rose-500 dark:via-pink-500 dark:to-red-500 hover:from-rose-700 hover:via-pink-700 hover:to-red-700 dark:hover:from-rose-400 dark:hover:via-pink-400 dark:hover:to-red-400",
    warning: "bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-600 dark:from-amber-500 dark:via-orange-500 dark:to-yellow-500 hover:from-amber-700 hover:via-orange-700 hover:to-yellow-700 dark:hover:from-amber-400 dark:hover:via-orange-400 dark:hover:to-yellow-400",
};

export default function PageHeader({ 
    title, 
    onBack, 
    backLabel,
    actions = [],
    children 
}: PageHeaderProps) {
    const titleRef = useRef<HTMLDivElement>(null);
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    
    const mouseXSpring = useSpring(x, { stiffness: 500, damping: 100 });
    const mouseYSpring = useSpring(y, { stiffness: 500, damping: 100 });
    
    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["17.5deg", "-17.5deg"]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-17.5deg", "17.5deg"]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!titleRef.current) return;
        const rect = titleRef.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const xPct = mouseX / width - 0.5;
        const yPct = mouseY / height - 0.5;
        x.set(xPct);
        y.set(yPct);
    };

    const handleMouseLeave = () => {
        x.set(0);
        y.set(0);
    };

    return (
        <>
            {/* Ultra Modern Back Button */}
            {onBack && (
                <motion.div
                    initial={{ opacity: 0, x: -50, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ 
                        duration: 0.6, 
                        ease: [0.34, 1.56, 0.64, 1],
                        type: "spring",
                        stiffness: 100
                    }}
                    className="mb-10"
                >
                    <motion.button
                        whileHover={{ scale: 1.03, x: -5 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={onBack}
                        className={`group relative flex items-center ${((backLabel === undefined ? "بازگشت به داشبورد" : backLabel) ? "gap-4 px-7 py-4" : "gap-0 px-4 py-4")} bg-white/80 dark:bg-gray-900/80 backdrop-blur-3xl hover:bg-white dark:hover:bg-gray-900/90 text-gray-800 dark:text-gray-100 font-bold rounded-3xl shadow-2xl hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-2 border-gray-200/60 dark:border-gray-700/60 hover:border-purple-400/80 dark:hover:border-purple-500/80 transition-all duration-500 overflow-hidden`}
                    >
                        {/* Animated gradient background */}
                        <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-purple-500/0 via-blue-500/10 to-purple-500/0 opacity-0 group-hover:opacity-100"
                            animate={{
                                backgroundPosition: ["0% 50%", "200% 50%", "0% 50%"],
                            }}
                            transition={{
                                duration: 4,
                                repeat: Infinity,
                                ease: "linear"
                            }}
                            style={{
                                backgroundSize: "200% 100%"
                            }}
                        />
                        
                        {/* Floating particles effect */}
                        {[...Array(3)].map((_, i) => (
                            <motion.div
                                key={i}
                                className="absolute w-2 h-2 bg-purple-400/30 rounded-full"
                                initial={{ 
                                    x: Math.random() * 100 + "%",
                                    y: Math.random() * 100 + "%",
                                    opacity: 0
                                }}
                                animate={{
                                    y: [null, "-100%", "100%"],
                                    opacity: [0, 1, 0],
                                    scale: [0, 1, 0]
                                }}
                                transition={{
                                    duration: 3 + i,
                                    repeat: Infinity,
                                    delay: i * 0.5,
                                    ease: "easeInOut"
                                }}
                            />
                        ))}
                        
                        {/* Animated arrow icon with glow */}
                        <motion.div
                            className="relative z-10"
                            animate={{ x: [0, -6, 0] }}
                            transition={{ 
                                duration: 2.5, 
                                repeat: Infinity, 
                                ease: "easeInOut" 
                            }}
                        >
                            <div className="relative">
                                <motion.div
                                    className="absolute inset-0 bg-purple-500/50 blur-xl"
                                    animate={{ 
                                        scale: [1, 1.5, 1],
                                        opacity: [0.5, 0.8, 0.5]
                                    }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        ease: "easeInOut"
                                    }}
                                />
                                <svg
                                    className="relative w-6 h-6 text-purple-600 dark:text-purple-400 drop-shadow-lg"
                                    fill="none"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="3"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path d="M15 19l-7-7 7-7" />
                                </svg>
                            </div>
                        </motion.div>
                        
                        {(backLabel === undefined ? "بازگشت به داشبورد" : backLabel) ? (
                            <span className="relative z-10 bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 dark:from-purple-300 dark:via-blue-300 dark:to-indigo-300 bg-clip-text text-transparent group-hover:from-purple-700 group-hover:via-blue-700 group-hover:to-indigo-700 dark:group-hover:from-purple-200 dark:group-hover:via-blue-200 dark:group-hover:to-indigo-200 transition-all duration-500 font-extrabold text-lg tracking-wide">
                                {backLabel === undefined ? "بازگشت به داشبورد" : backLabel}
                            </span>
                        ) : null}
                        
                        {/* Advanced shine effect */}
                        <motion.div
                            className="absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 group-hover:opacity-100"
                            initial={{ x: "-200%" }}
                            whileHover={{ x: "200%" }}
                            transition={{ duration: 0.8, ease: "easeInOut" }}
                        />
                    </motion.button>
                </motion.div>
            )}

            {!!title?.trim() && (
                <motion.div
                    initial={{ opacity: 0, y: -30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
                    className="mb-12"
                >
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                        {/* Advanced 3D Title with Parallax */}
                        <div 
                            ref={titleRef}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                            className="relative group cursor-default"
                        >
                            <motion.div
                                style={{
                                    rotateX,
                                    rotateY,
                                    transformStyle: "preserve-3d",
                                }}
                                className="relative"
                            >
                                <motion.h1
                                    className="text-2xl font-black leading-none relative"
                                    style={{
                                        transformStyle: "preserve-3d",
                                    }}
                                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    transition={{ duration: 0.8, delay: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
                                >
                                    {/* Multiple glow layers for depth */}
                                    <motion.span
                                        className="absolute inset-0 text-2xl font-black leading-none bg-gradient-to-r from-purple-600 via-blue-600 via-indigo-600 to-purple-600 dark:from-purple-300 dark:via-blue-300 dark:via-indigo-300 dark:to-purple-300 blur-3xl opacity-40 dark:opacity-50 pointer-events-none"
                                        animate={{
                                            opacity: [0.4, 0.6, 0.4],
                                        }}
                                        transition={{
                                            duration: 3,
                                            repeat: Infinity,
                                            ease: "easeInOut"
                                        }}
                                    >
                                        {title}
                                    </motion.span>
                                    <motion.span
                                        className="absolute inset-0 text-2xl font-black leading-none bg-gradient-to-r from-purple-600 via-blue-600 via-indigo-600 to-purple-600 dark:from-purple-300 dark:via-blue-300 dark:via-indigo-300 dark:to-purple-300 blur-2xl opacity-30 dark:opacity-40 pointer-events-none"
                                    >
                                        {title}
                                    </motion.span>
                                    <span 
                                        className="relative z-10 block text-2xl font-black leading-none bg-gradient-to-r from-purple-600 via-blue-600 via-indigo-600 to-purple-600 dark:from-purple-300 dark:via-blue-300 dark:via-indigo-300 dark:to-purple-300 bg-clip-text text-transparent" 
                                        style={{ transform: "translateZ(50px)" }}
                                    >
                                        {title}
                                    </span>
                                </motion.h1>
                            </motion.div>
                            
                            {/* Animated decorative elements */}
                            <motion.div
                                className="absolute -bottom-4 left-0 h-1.5 bg-gradient-to-r from-purple-500 via-blue-500 via-indigo-500 to-purple-500 dark:from-purple-400 dark:via-blue-400 dark:via-indigo-400 dark:to-purple-400 rounded-full shadow-lg shadow-purple-500/50"
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: "100%", opacity: 1 }}
                                transition={{ duration: 1, delay: 0.5, ease: "easeOut" }}
                            />
                            
                            {/* Floating accent dots */}
                            {[...Array(5)].map((_, i) => (
                                <motion.div
                                    key={i}
                                    className="absolute w-2 h-2 bg-gradient-to-r from-purple-400 to-blue-400 rounded-full"
                                    initial={{ 
                                        x: i * 20,
                                        y: -10,
                                        opacity: 0,
                                        scale: 0
                                    }}
                                    animate={{ 
                                        y: [-10, -20, -10],
                                        opacity: [0, 1, 0],
                                        scale: [0, 1, 0]
                                    }}
                                    transition={{
                                        duration: 2 + i * 0.3,
                                        repeat: Infinity,
                                        delay: 0.8 + i * 0.2,
                                        ease: "easeInOut"
                                    }}
                                />
                            ))}
                        </div>
                        
                        {/* Premium Action Buttons */}
                        {(actions.length > 0 || children) && (
                            <motion.div
                                initial={{ opacity: 0, x: 30, scale: 0.9 }}
                                animate={{ opacity: 1, x: 0, scale: 1 }}
                                transition={{ duration: 0.6, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                                className="flex gap-4 flex-wrap items-center"
                            >
                                {actions.map((action, index) => (
                                    <motion.button
                                        key={index}
                                        initial={{ opacity: 0, scale: 0.8, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        transition={{ 
                                            duration: 0.5, 
                                            delay: 0.4 + index * 0.1,
                                            type: "spring",
                                            stiffness: 200
                                        }}
                                        whileHover={{ 
                                            scale: 1.08,
                                            y: -4,
                                            rotateY: 5,
                                        }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={action.onClick}
                                        className={`relative px-8 py-4 ${action.variant ? variantStyles[action.variant] : variantStyles.primary} text-white font-extrabold rounded-2xl shadow-2xl hover:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] transition-all duration-500 flex items-center gap-3 overflow-hidden group ${action.className || ""}`}
                                        style={{
                                            transformStyle: "preserve-3d",
                                        }}
                                    >
                                        {/* Animated gradient overlay */}
                                        <motion.div
                                            className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/20 to-white/0 opacity-0 group-hover:opacity-100"
                                            animate={{
                                                backgroundPosition: ["0% 0%", "100% 100%"],
                                            }}
                                            transition={{
                                                duration: 2,
                                                repeat: Infinity,
                                                repeatType: "reverse",
                                                ease: "linear"
                                            }}
                                        />
                                        
                                        {/* Shine sweep effect */}
                                        <motion.div
                                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full"
                                            transition={{ duration: 0.8, ease: "easeInOut" }}
                                        />
                                        
                                        {/* Icon with 3D rotation */}
                                        {action.icon && (
                                            <motion.span
                                                className="relative z-10"
                                                whileHover={{ 
                                                    rotate: [0, -10, 10, -10, 0],
                                                    scale: 1.2
                                                }}
                                                transition={{ duration: 0.5 }}
                                            >
                                                {action.icon}
                                            </motion.span>
                                        )}
                                        
                                        {/* Label with glow */}
                                        <span className="relative z-10 tracking-wider text-base drop-shadow-lg">
                                            {action.label}
                                        </span>
                                        
                                        {/* Ripple effect */}
                                        <motion.div
                                            className="absolute inset-0 rounded-2xl"
                                            initial={{ scale: 0, opacity: 0.6 }}
                                            whileTap={{ scale: 2.5, opacity: 0 }}
                                            transition={{ duration: 0.6 }}
                                            style={{
                                                background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)"
                                            }}
                                        />
                                        
                                        {/* Border glow */}
                                        <motion.div
                                            className="absolute inset-0 rounded-2xl border-2 border-white/20 opacity-0 group-hover:opacity-100"
                                            transition={{ duration: 0.3 }}
                                        />
                                    </motion.button>
                                ))}
                                {children}
                            </motion.div>
                        )}
                    </div>
                </motion.div>
            )}
        </>
    );
}
