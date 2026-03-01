import { useState, useEffect } from 'react';

export function useTimer(startTime?: number, endTime?: number) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!startTime) {
            setElapsed(0);
            return;
        }

        if (endTime) {
            setElapsed(Math.floor((endTime - startTime) / 1000));
            return;
        }

        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);

        return () => clearInterval(interval);
    }, [startTime, endTime]);

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}
