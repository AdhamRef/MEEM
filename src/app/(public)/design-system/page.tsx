import { BookOpen, Inbox, Play, Share2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { StateMessage } from "@/components/shared/state-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLoading } from "@/components/shared/page-loading";
import { ThrowOnClick } from "./throw-on-click";

export const metadata: Metadata = { title: "نظام التصميم", robots: { index: false, follow: false } };

const COLORS = [
  ["background", "bg-background"],
  ["surface", "bg-surface"],
  ["surface-elevated", "bg-surface-elevated"],
  ["border", "bg-border"],
  ["text-secondary", "bg-text-secondary"],
  ["subtle", "bg-subtle"],
  ["text-primary", "bg-text-primary"],
  ["accent", "bg-brand"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A development-only reference for reviewing the design system, including Arabic rendering.
 * Sample content below only demonstrates typography. It is unavailable in production.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-12 px-4 py-8 md:px-8">
      <h1 className="text-3xl">نظام التصميم</h1>

      <Section title="الألوان">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLORS.map(([name, className]) => (
            <div key={name} className="space-y-2">
              <div className={`h-16 rounded-xl border ${className}`} />
              <p dir="ltr" className="text-end text-sm text-text-secondary">
                {name}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="الخطوط والأوزان">
        <div className="space-y-2">
          <p className="text-4xl font-bold">عنوان رئيسي بخط عريض</p>
          <p className="text-2xl font-semibold">عنوان فرعي بخط شبه عريض</p>
          <p className="text-lg font-medium">نص متوسط الوزن للتأكيد</p>
          <p>نص عادي يُستخدم في أغلب أجزاء الواجهة، مع علامات الترقيم العربية الصحيحة: الفاصلة، والنقطة؛ والسؤال؟</p>
          <p className="font-light text-text-secondary">نص خفيف للمعلومات الثانوية.</p>
        </div>
      </Section>

      <Section title="النص القرآني">
        <blockquote lang="ar" className="text-quran rounded-xl border bg-surface p-5">
          بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ۝ ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ ۝ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ۝ مَٰلِكِ يَوْمِ ٱلدِّينِ
        </blockquote>
      </Section>

      <Section title="النص المختلط">
        <div className="space-y-2">
          <p>
            يعرض هذا المقطع قناة <bdi>Yaqeen Institute</bdi> على منصة <bdi>YouTube</bdi> منذ عام <bdi>2024</bdi>.
          </p>
          <p>
            الرابط: <bdi dir="ltr">https://example.com/path?id=42</bdi> ثم يكمل النص.
          </p>
          <p dir="auto">Next.js and Prisma: عنوان يبدأ بالإنجليزية.</p>
        </div>
      </Section>

      <Section title="الأزرار">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Play aria-hidden data-icon="inline-start" />
            أساسي
          </Button>
          <Button variant="secondary">ثانوي</Button>
          <Button variant="outline">محدد</Button>
          <Button variant="ghost">شفاف</Button>
          <Button variant="destructive">حذف</Button>
          <Button variant="link">رابط</Button>
          <Button disabled>معطل</Button>
          <Button size="icon" variant="secondary" aria-label="مشاركة">
            <Share2 aria-hidden />
          </Button>
        </div>
      </Section>

      <Section title="الحقول والشارات">
        <div className="max-w-sm space-y-3">
          <label htmlFor="sample-input" className="block text-sm font-medium">
            حقل نصي
          </label>
          <Input id="sample-input" placeholder="اكتب هنا" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>العقيدة</Badge>
          <Badge variant="secondary">الفقه</Badge>
          <Badge variant="outline">السيرة</Badge>
        </div>
      </Section>

      <Section title="البطاقات">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>عنوان البطاقة</CardTitle>
              <CardDescription>وصف مختصر يوضح محتوى البطاقة.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">محتوى البطاقة.</p>
            </CardContent>
          </Card>
          <div className="space-y-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </Section>

      <Section title="تنسيق المقالات">
        <article className="prose-article">
          <h2>عنوان من المستوى الثاني</h2>
          <p>
            هذه فقرة تجريبية لاختبار راحة القراءة، بطول سطر مناسب وتباعد مريح بين الأسطر. وفيها <strong>نص عريض</strong> و
            <em>نص مائل</em> و<a href="#sample">رابط داخلي</a>.
          </p>
          <h3>عنوان من المستوى الثالث</h3>
          <ul>
            <li>العنصر الأول في القائمة</li>
            <li>العنصر الثاني في القائمة</li>
          </ul>
          <ol>
            <li>الخطوة الأولى</li>
            <li>الخطوة الثانية</li>
          </ol>
          <blockquote>اقتباس تجريبي يظهر بخط جانبي على بداية السطر، أي على اليمين في الاتجاه العربي.</blockquote>
          <p>
            نص يتضمن كودًا مثل <code>npm run dev</code> داخل الجملة.
          </p>
        </article>
      </Section>

      <Separator />

      <Section title="الحالات">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border">
            <StateMessage icon={Inbox} title="لا يوجد محتوى" description="هذا مثال على الحالة الفارغة." />
          </div>
          <div className="rounded-xl border">
            <PageLoading />
          </div>
        </div>
        <ThrowOnClick icon={<BookOpen aria-hidden data-icon="inline-start" />} />
      </Section>
    </div>
  );
}
