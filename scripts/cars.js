// Shared by the garage and driving simulation. All cars are free to select.
export const CARS = Object.freeze([
  { id: 'compact', name: 'نسیم شهری', maxSpeed: 100, color: '#6ee7b7', type: 'compact', description: 'کوچک، سبک و مناسب گشت‌وگذار در شهر' },
  { id: 'sedan', name: 'آریا کلاسیک', maxSpeed: 160, color: '#60a5fa', type: 'sedan', description: 'سدان متعادل برای رانندگی روزمره' },
  { id: 'suv', name: 'کوهستان', maxSpeed: 220, color: '#f5b455', type: 'suv', description: 'شاسی‌بلند قدرتمند برای مسیرهای خارج شهر' },
  { id: 'sport', name: 'شهاب اسپرت', maxSpeed: 300, color: '#fb7185', type: 'sport', description: 'چابک و آمادهٔ دریفت در پیچ‌ها' },
  { id: 'super', name: 'آذر سوپر', maxSpeed: 400, color: '#a78bfa', type: 'super', description: 'سرعت بالا و بدنهٔ آیرودینامیک' },
  { id: 'hyper', name: 'صاعقه', maxSpeed: 500, color: '#22d3ee', type: 'hyper', description: 'سریع‌ترین خودرو برای مسیرهای باز' },
]);

export function getCar(id) {
  return CARS.find(car => car.id === id) || CARS[0];
}
