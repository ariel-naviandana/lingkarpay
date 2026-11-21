import { useEffect, useRef, useState } from "react";

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

interface CalendarDropdownProps {
  value: string; // YYYY-MM-DD
  onChange: (dateStr: string) => void;
  minDate?: string; // YYYY-MM-DD
  className?: string;
}

export function CalendarDropdown({
  value,
  onChange,
  minDate,
  className = "",
}: CalendarDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial selected date
  const selectedDate = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(() => selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => selectedDate.getMonth());

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // Keep view in sync when value changes from outside
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T00:00:00");
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();

  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    const dateStr = `${viewYear}-${mm}-${dd}`;
    onChange(dateStr);
    setOpen(false);
  };

  const handlePreset = (daysFromNow: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    onChange(dateStr);
    setViewYear(yyyy);
    setViewMonth(target.getMonth());
    setOpen(false);
  };

  // Format display label
  const formattedDisplay = value
    ? new Date(value + "T00:00:00").toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Pilih tanggal mulai...";

  const minTime = minDate ? new Date(minDate + "T00:00:00").getTime() : null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger Button that looks like a Select Dropdown */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-left font-normal text-stone-800 shadow-sm hover:border-brand focus:outline-2 focus:outline-brand transition cursor-pointer"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 truncate">
          <svg
            className="w-4 h-4 text-stone-500 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="font-semibold text-stone-900">{formattedDisplay}</span>
        </div>
        <svg
          className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Calendar Dropdown Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-72 sm:w-80 rounded-2xl border border-sand bg-white p-4 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100">
          {/* Calendar Header */}
          <div className="flex items-center justify-between pb-3 border-b border-sand">
            <button
              type="button"
              onClick={prevMonth}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-stone-100 text-stone-600 transition cursor-pointer"
              title="Bulan sebelumnya"
            >
              ‹
            </button>
            <div className="text-sm font-extrabold text-stone-900">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </div>
            <button
              type="button"
              onClick={nextMonth}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-stone-100 text-stone-600 transition cursor-pointer"
              title="Bulan berikutnya"
            >
              ›
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex gap-1.5 py-2.5 overflow-x-auto border-b border-sand">
            <button
              type="button"
              onClick={() => handlePreset(0)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sand/60 hover:bg-brand hover:text-white transition cursor-pointer whitespace-nowrap"
            >
              Hari ini
            </button>
            <button
              type="button"
              onClick={() => handlePreset(1)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sand/60 hover:bg-brand hover:text-white transition cursor-pointer whitespace-nowrap"
            >
              Besok
            </button>
            <button
              type="button"
              onClick={() => handlePreset(7)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sand/60 hover:bg-brand hover:text-white transition cursor-pointer whitespace-nowrap"
            >
              +1 Minggu
            </button>
            <button
              type="button"
              onClick={() => handlePreset(30)}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sand/60 hover:bg-brand hover:text-white transition cursor-pointer whitespace-nowrap"
            >
              +1 Bulan
            </button>
          </div>

          {/* Day Names Grid */}
          <div className="grid grid-cols-7 pt-3 text-center text-[11px] font-bold text-stone-400">
            {DAY_NAMES.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 pt-2 text-center text-xs">
            {/* Blanks for days before month start */}
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`blank-${i}`} className="h-8" />
            ))}

            {/* Days of current month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const curDate = new Date(viewYear, viewMonth, day);
              const curStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = value === curStr;
              const isToday = curStr === todayStr;
              const isDisabled = minTime !== null && curDate.getTime() < minTime;

              return (
                <button
                  key={day}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectDay(day)}
                  className={`grid h-8 w-8 place-items-center mx-auto rounded-full font-semibold transition cursor-pointer ${
                    isSelected
                      ? "bg-brand text-white shadow-sm"
                      : isDisabled
                      ? "text-stone-300 cursor-not-allowed"
                      : isToday
                      ? "border border-brand text-brand font-bold hover:bg-mint"
                      : "text-stone-700 hover:bg-cream"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
