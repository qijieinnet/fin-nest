-- 记账设置：移动端记账表单进入时是否自动展开金额键盘。
--
-- 默认 false：键盘展开会占掉下半屏，日期/备注等靠后的字段要滚动才看得见。
-- 习惯「进来就输金额」的用户可以自己打开，但不该是所有人的默认。
--
-- 只作用于移动壳（<1024px）；桌面端表单用可见控件 + 物理键盘，读不到这个开关。

ALTER TABLE record_settings ADD COLUMN keypad_auto_open BOOLEAN NOT NULL DEFAULT false;
