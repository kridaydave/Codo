import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface TypingTextProps {
    text: string;
    speed?: number;
    animate?: boolean;
}

export function TypingText({ text, speed = 15, animate = true }: TypingTextProps) {
    const [displayedText, setDisplayedText] = useState(animate ? '' : text);
    const [currentIndex, setCurrentIndex] = useState(animate ? 0 : text.length);

    useEffect(() => {
        if (!animate) {
            setDisplayedText(text);
            setCurrentIndex(text.length);
            return;
        }

        if (currentIndex < text.length) {
            const timeout = setTimeout(() => {
                const charsToReveal = Math.min(3, text.length - currentIndex);
                setDisplayedText(text.substring(0, currentIndex + charsToReveal));
                setCurrentIndex(currentIndex + charsToReveal);
            }, speed);
            return () => clearTimeout(timeout);
        } else if (displayedText !== text) {
            // Failsafe in case text updates but we're past its length somehow
            setDisplayedText(text);
            setCurrentIndex(text.length);
        }
    }, [currentIndex, text, speed, animate]);

    // Fast-forward effect if text changes while animating
    useEffect(() => {
        if (animate && text !== displayedText && text.startsWith(displayedText)) {
            // Continue animating
        } else if (text !== displayedText) {
            // Start over or fast forward
            setDisplayedText(animate ? '' : text);
            setCurrentIndex(animate ? 0 : text.length);
        }
    }, [text, animate]);

    return <Text>{displayedText}</Text>;
}
