import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment-jalaali';
import { georgianToPersian, persianToGeorgian } from '../utils/date';

interface PersianDatePickerProps {
  value: string; // Georgian date string (YYYY-MM-DD) from database
  onChange: (georgianDate: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

export default function PersianDatePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ (مثال: 1403/01/15)',
  className = '',
  required = false,
  disabled = false,
}: PersianDatePickerProps) {
  const [persianDate, setPersianDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarRect, setCalendarRect] = useState<{ top: number; left: number } | null>(null);
  const [currentMonth, setCurrentMonth] = useState(moment().jMonth() + 1);
  const [currentYear, setCurrentYear] = useState(moment().jYear());
  const triggerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Convert Georgian date to Persian on mount and when value changes
  useEffect(() => {
    if (value) {
      const persian = georgianToPersian(value);
      setPersianDate(persian);
    } else {
      setPersianDate('');
    }
  }, [value]);

  // Position calendar when opening
  useEffect(() => {
    if (showCalendar && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCalendarRect({ top: rect.bottom, left: rect.left });
    } else {
      setCalendarRect(null);
    }
  }, [showCalendar]);

  // Update calendar position on scroll/resize when open
  useEffect(() => {
    if (!showCalendar || !triggerRef.current) return;
    const updatePos = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCalendarRect({ top: rect.bottom, left: rect.left });
      }
    };
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [showCalendar]);

  // Close calendar when clicking outside (trigger or calendar)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inCalendar = calendarRef.current?.contains(target);
      if (!inTrigger && !inCalendar) {
        setShowCalendar(false);
      }
    };

    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCalendar]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setPersianDate(inputValue);
    
    // Validate and convert Persian date to Georgian
    const parts = inputValue.split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        const georgian = persianToGeorgian(inputValue);
        if (georgian) {
          onChange(georgian);
        }
      }
    }
  };

  const handleDateSelect = (year: number, month: number, day: number) => {
    const persianDateStr = `${year}/${month}/${day}`;
    setPersianDate(persianDateStr);
    const georgian = persianToGeorgian(persianDateStr);
    onChange(georgian);
    setShowCalendar(false);
  };

  const getDaysInMonth = (year: number, month: number): number => {
    return moment(`${year}/${month}/1`, 'jYYYY/jMM/jDD').daysInMonth();
  };

  const getFirstDayOfMonth = (year: number, month: number): number => {
    const firstDay = moment(`${year}/${month}/1`, 'jYYYY/jMM/jDD');
    // moment.day() returns 0 (Sunday) to 6 (Saturday)
    // Persian week starts on Saturday (6), so we convert:
    // Saturday (6) -> 0, Sunday (0) -> 1, ..., Friday (5) -> 6
    const day = firstDay.day();
    return day === 6 ? 0 : day + 1;
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const days: (number | null)[] = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    // Dari week days: شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه
    const weekDays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

    // Dari month names for Solar Hijri calendar
    const monthNames = [
      'حمل',      // فروردین
      'ثور',      // اردیبهشت
      'جوزا',     // خرداد
      'سرطان',    // تیر
      'اسد',      // مرداد
      'سنبله',    // شهریور
      'میزان',    // مهر
      'عقرب',     // آبان
      'قوس',      // آذر
      'جدی',      // دی
      'دلو',      // بهمن
      'حوت'       // اسفند
    ];

    if (!calendarRect) return null;

    return (
      <div
        ref={calendarRef}
        className="fixed z-[9999] bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-600 rounded-xl shadow-xl p-4 min-w-[300px]"
        style={{ top: calendarRect.top, left: calendarRect.left }}
      >
        {/* Calendar Header */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => {
              if (currentMonth === 1) {
                setCurrentMonth(12);
                setCurrentYear(currentYear - 1);
              } else {
                setCurrentMonth(currentMonth - 1);
              }
            }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-lg font-bold text-gray-900 dark:text-white">
            {monthNames[currentMonth - 1]} {currentYear}
          </div>
          <button
            type="button"
            onClick={() => {
              if (currentMonth === 12) {
                setCurrentMonth(1);
                setCurrentYear(currentYear + 1);
              } else {
                setCurrentMonth(currentMonth + 1);
              }
            }}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Week Days */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((day, index) => (
            <div key={index} className="text-center text-sm font-semibold text-gray-600 dark:text-gray-400 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, index) => {
            if (day === null) {
              return <div key={index} className="p-2"></div>;
            }
            
            const isSelected = persianDate === `${currentYear}/${currentMonth}/${day}`;
            const isToday = moment().jYear() === currentYear && 
                           moment().jMonth() + 1 === currentMonth && 
                           moment().jDate() === day;

            return (
              <button
                key={index}
                type="button"
                onClick={() => handleDateSelect(currentYear, currentMonth, day)}
                className={`p-2 rounded-lg text-sm transition-colors ${
                  isSelected
                    ? 'bg-purple-500 text-white font-bold'
                    : isToday
                    ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-semibold'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* Today Button */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => {
              const today = moment();
              handleDateSelect(today.jYear(), today.jMonth() + 1, today.jDate());
            }}
            className="w-full py-2 px-4 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold transition-colors"
          >
            امروز
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`relative ${className}`} ref={triggerRef}>
      <div className="relative">
        <input
          type="text"
          value={persianDate}
          onChange={handleInputChange}
          onFocus={() => setShowCalendar(true)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          dir="rtl"
          className="w-full px-4 py-3 pr-12 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => setShowCalendar(!showCalendar)}
          disabled={disabled}
          className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors disabled:opacity-50"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
      {showCalendar && calendarRect && createPortal(renderCalendar(), document.body)}
    </div>
  );
}
