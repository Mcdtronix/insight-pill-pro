# Pharmacy Insight Hub

ROLE

Act as a senior frontend architect, React engineer, UI/UX designer, and data-visualization specialist.

Your task is to build a complete, production-quality React frontend for an Intelligent Pharmacy Decision Support System (DSS).

This is an academic/final-year software engineering project, but the frontend must look and behave like a real enterprise pharmacy inventory and decision-support platform, suitable for demonstration to pharmacy managers, supervisors, software engineers, and academic examiners.

Do not create a generic admin dashboard.

The interface must clearly communicate that this system uses data analytics, forecasting, inventory intelligence, supplier evaluation, and expiry-risk analysis to support pharmacy decision-making.

1. SYSTEM CONTEXT

The system consists of:

React frontend

Django REST Framework backend

PostgreSQL database

Machine-learning/decision-support engine

JWT authentication

Role-based access control

The backend exposes REST APIs for:

Medicines

Inventory

Stock transactions

Demand forecasts

Reorder recommendations

Suppliers

Supplier performance

Expiry-risk monitoring

Authentication

The frontend must be architected so that the backend can be connected later without rewriting the UI.

Use a clean API abstraction layer.

Expected backend API examples include:

GET    /api/medicines/
GET    /api/medicines/{id}/
GET    /api/medicines/{id}/forecast/

GET    /api/inventory/
GET    /api/inventory/expiry-risk/

GET    /api/recommendations/reorder/
POST   /api/recommendations/reorder/{id}/approve/

GET    /api/suppliers/
GET    /api/suppliers/{id}/performance/

POST   /api/token/
POST   /api/token/refresh/


Do not hardcode API calls directly inside page components.

Create a centralized API layer.

2. TECHNOLOGY STACK

Use:

React

Vite

JavaScript or TypeScript

React Router

Axios

TanStack Query

Tailwind CSS

shadcn/ui or an equivalent reusable component architecture

Lucide React icons

Recharts for data visualization

TanStack Table for advanced tables

React Hook Form for forms

Zod for validation where appropriate

date-fns for date manipulation

Use modern React practices.

Avoid unnecessary Redux.

Use Context only for application-level concerns such as authentication/session state.

3. DESIGN PHILOSOPHY

The design should feel like:

Enterprise Healthcare + Business Intelligence + Modern SaaS

Visual characteristics:

clean

professional

clinical

trustworthy

information-dense without feeling cluttered

modern

accessible

responsive

highly readable

suitable for desktop pharmacy environments

Avoid:

excessive gradients

flashy animations

excessive rounded cards

unnecessary glassmorphism

gaming-style interfaces

excessive colors

giant decorative graphics

meaningless dashboard widgets

Prioritize:

information hierarchy

actionable insights

data visualization

clear status indicators

decision support

accessibility

usability

Use a restrained healthcare-oriented color system.

Use color semantically:

green → healthy/safe

amber → warning

red → critical

blue → information

neutral gray → normal/system information

Do not use color as the only method of communicating status.

4. APPLICATION SHELL

Create a persistent application layout.

Desktop structure:

┌───────────────────────────────────────────────────────────────┐
│ Top Header                                                    │
│ Search | Notifications | Help | User Profile                 │
├──────────────┬────────────────────────────────────────────────┤
│              │                                                │
│ Sidebar      │ Main Content                                   │
│              │                                                │
│ Dashboard    │                                                │
│ Inventory    │                                                │
│ Forecasting  │                                                │
│ Reorders     │                                                │
│ Suppliers    │                                                │
│ Expiry Risk  │                                                │
│ Reports      │                                                │
│              │                                                │
│ Settings     │                                                │
│              │                                                │
└──────────────┴────────────────────────────────────────────────┘


Sidebar requirements:

collapsible

icons + labels

active route highlighting

tooltips when collapsed

section grouping

user role-aware navigation

mobile drawer behavior

Top navigation:

global search

notification center

current user

role badge

profile menu

logout

system status indicator

5. LOGIN PAGE

Create a polished authentication page.

Include:

pharmacy/DSS branding

email/username field

password field

show/hide password

remember session option

login button

loading state

validation errors

API errors

session expiration handling

Example visual structure:

┌────────────────────────────────────────────┐
│                                            │
│        Pharmacy Decision Support           │
│                                            │
│        Intelligent Inventory Management    │
│                                            │
│        Username                            │
│        [________________________]          │
│                                            │
│        Password                            │
│        [________________________]          │
│                                            │
│        [        Sign In        ]           │
│                                            │
└────────────────────────────────────────────┘


Do not implement fake authentication if the API is available.

Create the authentication architecture so JWT can be connected immediately.

6. DASHBOARD

The dashboard is the most important screen.

It should answer:

"What needs my attention right now?"

Create executive KPI cards:

Inventory KPIs

Total Medicines

Total Inventory Value

Low Stock Items

Out-of-Stock Items

Decision Support KPIs

Reorder Recommendations

Critical Reorders

Medicines at Expiry Risk

Expected Demand Increase

Supplier KPIs

Active Suppliers

Average Supplier Score

Late Deliveries

Pending Orders

Each KPI card should contain:

icon

value

descriptive label

trend indicator

comparison against previous period

optional tooltip

7. DASHBOARD VISUALIZATIONS

Create a demand trend chart:

Demand
  │
  │              ╭──── Forecast
  │          ╭───╯
  │      ╭───╯
  │  ╭───╯
  │──┼──────────────────────── Time
     Historical     Forecast


Use:

historical demand

forecast demand

confidence interval where available

legend

tooltip

selectable medicine/category

date range selector

Create an inventory health visualization.

Example categories:

Healthy

Low Stock

Critical

Out of Stock

Expiring

Create an expiry-risk visualization.

Create a supplier performance ranking.

Create a "Recommended Actions" section.

Example:

Priority   Medicine          Recommendation
------------------------------------------------
Critical   Amoxicillin       Reorder 500 units
High       Paracetamol       Reorder 300 units
High       Metformin         Review supplier
Medium     Ibuprofen         Monitor expiry


8. INTELLIGENT INSIGHTS PANEL

Create a prominent section called:

Decision Intelligence

This section should translate analytics into understandable recommendations.

Examples:

Demand for Amoxicillin is forecast to increase by 18% over the next 30 days.

Current stock is expected to fall below the reorder point in approximately 6 days.

Supplier ABC has experienced a 14% increase in average delivery time.

120 units of Medicine X are at high expiry risk based on current consumption.

Every insight should contain:

severity

explanation

supporting metric

recommended action

link to detailed analysis

Do not make the interface claim that an AI model performed an analysis if the backend has not provided that result.

9. INVENTORY MANAGEMENT

Create a professional inventory page.

Features:

searchable medicine table

pagination

sorting

filtering

category filtering

stock-status filtering

supplier filtering

expiry filtering

export button

column visibility control

Columns:

Medicine
Category
Current Stock
Reorder Point
Safety Stock
Daily Consumption
Supplier
Unit Cost
Expiry Date
Stock Status
Actions


Status badges:

In Stock

Low Stock

Critical

Out of Stock

Expiring Soon

Create a detailed medicine page.

Show:

medicine information

current inventory

historical consumption

stock transactions

forecast

reorder recommendation

suppliers

expiry information

10. DEMAND FORECASTING PAGE

Create a dedicated Forecasting module.

The user should be able to:

Search for a medicine

Select forecasting period

View historical demand

View forecast

Compare actual vs predicted

View forecast confidence

View model metrics

Display:

MAE

RMSE

MAPE where appropriate

forecast horizon

model version

training date

Example:

Medicine: Amoxicillin 500mg

Forecast Horizon: 30 Days

Historical Demand ────────────────┐
                                  ├── Forecast
                                  │
                                  └── Confidence Interval


Include a model information panel:

Model
XGBoost

Model Version
v1.4

Training Date
05 Sep 2026

MAE
12.4 units

RMSE
18.7 units


The UI must distinguish:

Historical data

from

Forecasted data

very clearly.

11. REORDER RECOMMENDATIONS

This is a critical decision-support screen.

Create a table containing:

Medicine
Current Stock
Reorder Point
Predicted Demand
Safety Stock
Suggested Quantity
Preferred Supplier
Estimated Cost
Priority
Confidence
Action


Each recommendation must support:

View details

Approve

Adjust quantity

Reject

View supporting forecast

Approval must require confirmation.

Example confirmation dialog:

Approve Reorder

Medicine:
Amoxicillin 500mg

Recommended Quantity:
500 units

Estimated Cost:
$425.00

Supplier:
ABC Pharmaceuticals

Reason:
Projected demand exceeds available inventory.

[Cancel] [Approve Reorder]


Do not silently execute actions.

12. SUPPLIER PERFORMANCE

Create a Supplier Intelligence module.

Supplier table:

Supplier
Overall Score
On-Time Delivery
Price Consistency
Defect Rate
Average Lead Time
Lead Time Variance
Status


Supplier details page should include:

overall score

performance trend

delivery performance

price consistency

defect/return rate

lead time

order history

Create a supplier scoring visualization.

The scoring criteria should be visible rather than hiding everything behind one number.

For example:

Overall Score: 82/100

On-Time Delivery       █████████░ 90%
Price Consistency      ████████░░ 82%
Quality                 █████████░ 91%
Lead Time               ███████░░░ 74%


13. EXPIRY-RISK MONITORING

Create a dedicated Expiry Risk Board.

Display medicine batches grouped by:

Critical

Likely to expire before being consumed.

High Risk

Short remaining shelf life and significant stock.

Medium Risk

Requires monitoring.

Low Risk

No immediate concern.

Each record should display:

medicine

batch number

quantity

expiry date

days remaining

average daily consumption

projected remaining stock at expiry

risk level

recommended action

Example:

Amoxicillin 500mg

Batch: AMX-2026-04

Stock: 420 units
Expiry: 32 days
Consumption: 8/day

Projected unused stock at expiry:
164 units

Risk: HIGH

Recommendation:
Prioritize this batch for dispensing.


Use FEFO concepts where applicable.

14. REPORTS

Create a Reports module.

Reports should include:

inventory report

stock movement report

demand forecast report

reorder report

supplier performance report

expiry-risk report

Allow:

date ranges

medicine filters

supplier filters

categories

stock status

export to CSV/PDF where backend supports it

Create a report-generation interface rather than dumping raw tables onto the page.

15. NOTIFICATION CENTER

Create notifications for:

critical stock

reorder recommendations

expiring medicines

supplier delays

forecast anomalies

system events

Notification examples:

Critical Stock
Amoxicillin 500mg has fallen below its critical stock level.

Expiry Risk
120 units of Medicine X may expire before expected consumption.

Supplier Delay
ABC Pharmaceuticals has delayed Order #1042.


Allow:

mark as read

mark all as read

filter by type

navigate to related resource

16. SEARCH

Implement global search.

Search across:

medicines

suppliers

orders

recommendations

Use debounced search.

Display grouped results:

Medicines
  Amoxicillin 500mg
  Amoxicillin 250mg

Suppliers
  ABC Pharmaceuticals

Recommendations
  Reorder Recommendation #1042


17. LOADING STATES

Every API-dependent screen must have professional loading states.

Use:

skeleton loaders

table skeletons

chart skeletons

button loading states

page-level loading indicators

Do not display blank pages while data is loading.

18. ERROR HANDLING

Implement consistent error handling.

Support:

network failure

API 400

API 401

API 403

API 404

API 500

expired JWT

timeout

Example:

Unable to load inventory

We couldn't retrieve the latest inventory data.

[Retry]


Do not expose raw backend stack traces to users.

19. EMPTY STATES

Every major data component must have a useful empty state.

Example:

No expiry risks detected

There are currently no medicines requiring expiry-risk intervention.

[View Inventory]


Avoid generic:

"No data."

20. RESPONSIVE DESIGN

Primary target:

Desktop pharmacy workstation

But support:

tablet

laptop

mobile

On smaller screens:

collapse sidebar

convert tables into cards where necessary

stack charts

preserve important actions

avoid horizontal overflow wherever practical

21. ACCESSIBILITY

Implement:

semantic HTML

keyboard navigation

visible focus states

ARIA labels where necessary

accessible dialogs

accessible tables

accessible form validation

sufficient color contrast

non-color status indicators

22. AUTHORIZATION

Implement role-aware frontend behavior.

Potential roles:

Admin
Pharmacy Manager
Pharmacist
Staff


Examples:

Admin → full system access

Pharmacy Manager → inventory, recommendations, suppliers, reports

Pharmacist → inventory, forecasts, expiry monitoring

Staff → limited operational functionality

Frontend authorization must complement backend authorization.

Never rely on frontend authorization for security.

The Django backend remains the source of truth.

23. API ARCHITECTURE

Create:

src/
├── api/
│   ├── axios.js
│   ├── authApi.js
│   ├── medicineApi.js
│   ├── inventoryApi.js
│   ├── forecastApi.js
│   ├── recommendationApi.js
│   ├── supplierApi.js
│   └── reportApi.js
│
├── components/
│   ├── ui/
│   ├── charts/
│   ├── tables/
│   ├── dashboard/
│   ├── inventory/
│   ├── forecasting/
│   ├── suppliers/
│   └── recommendations/
│
├── pages/
│   ├── Login/
│   ├── Dashboard/
│   ├── Inventory/
│   ├── Forecasting/
│   ├── Recommendations/
│   ├── Suppliers/
│   ├── ExpiryRisk/
│   ├── Reports/
│   └── Settings/
│
├── context/
│   └── AuthContext.jsx
│
├── hooks/
│   ├── useAuth.js
│   ├── useInventory.js
│   ├── useForecast.js
│   ├── useRecommendations.js
│   └── useSuppliers.js
│
├── layouts/
│   └── DashboardLayout.jsx
│
├── routes/
│   └── AppRoutes.jsx
│
├── utils/
│   ├── formatting.js
│   ├── permissions.js
│   └── constants.js
│
└── App.jsx


Keep components modular.

Avoid giant files.

24. TANSTACK QUERY

Use TanStack Query for server state.

Implement:

queries

mutations

caching

invalidation

loading states

error states

optimistic updates only where appropriate

Example conceptual pattern:

useQuery({
  queryKey: ['inventory'],
  queryFn: getInventory
})


After approving a reorder:

queryClient.invalidateQueries({
  queryKey: ['recommendations']
})


Do not use useEffect as the primary server-state management mechanism.

25. MOCK DATA

Initially create realistic mock data so the entire frontend can be demonstrated before the Django API is connected.

However:

Clearly separate mock services from real API services.

Create something such as:

src/mock/


The UI should later switch from:

mock API


to:

Django REST API


through environment configuration.

Do not mix mock data directly into components.

26. ENVIRONMENT CONFIGURATION

Use:

VITE_API_URL


Example:

VITE_API_URL=http://localhost:8000/api


Never hardcode:

http://localhost:8000


inside React components.

Prepare the project for production deployment.

27. ROUTING

Implement routes similar to:

/login

/dashboard

/inventory
/inventory/:id

/forecasting
/forecasting/:medicineId

/recommendations
/recommendations/:id

/suppliers
/suppliers/:id

/expiry-risk

/reports

/settings


Protect authenticated routes.

Redirect unauthenticated users to /login.

Redirect authenticated users away from /login.

28. UX DETAILS

Add subtle, purposeful animations:

page transitions

modal transitions

dropdown transitions

notification transitions

chart entrance animations

Do not over-animate.

Use skeleton loading instead of spinning loaders everywhere.

Use toast notifications for:

successful actions

rejected actions

failed operations

29. DASHBOARD INFORMATION HIERARCHY

The dashboard should prioritize:

Level 1 — Critical Actions

stockouts

critical reorders

critical expiry risks

Level 2 — Decision Support

demand forecasts

reorder recommendations

supplier performance

Level 3 — Monitoring

inventory trends

stock movement

historical analytics

The user should understand the pharmacy's operational condition within approximately 10 seconds of opening the dashboard.

30. DATA VISUALIZATION RULES

Charts must have:

meaningful titles

axis labels

legends

tooltips

units

date ranges

empty states

Never create charts merely for decoration.

Every visualization should answer a business question.

Examples:

Demand Forecast

How much medicine will we need?

Inventory Trend

Is stock increasing or decreasing?

Supplier Score

Which suppliers are reliable?

Expiry Risk

Which stock could become waste?

31. PHARMACY-SPECIFIC UX

Use pharmacy terminology consistently.

Examples:

Medicine

Batch

Stock Level

Reorder Point

Safety Stock

Lead Time

Consumption Rate

Supplier

Expiry Date

Forecast

Demand

FEFO

Reorder Recommendation

Do not use generic e-commerce terminology such as:

Products

Shopping Cart

Customers

Purchases

unless the backend specifically requires it.

32. EXPLAINABILITY

A major purpose of the system is decision support.

Whenever a recommendation is displayed, show:

What is being recommended?

Why is it being recommended?

What data supports the recommendation?

Example:

REORDER RECOMMENDATION

Recommended quantity: 500 units

Why?

• Current stock: 120 units
• Reorder point: 250 units
• Forecast demand: 460 units
• Lead time: 7 days
• Safety stock: 100 units

Expected stockout risk:
HIGH


Do not hide decision logic behind an unexplained AI score.

33. MODEL TRANSPARENCY

For forecasting pages, provide an optional "Model Information" panel.

Display:

algorithm

model version

training date

forecast horizon

MAE

RMSE

MAPE when appropriate

Do not fabricate metrics.

If backend data is unavailable, display:

Not available


rather than inventing values.

34. PROJECT QUALITY

Write clean, maintainable code.

Requirements:

reusable components

clear naming

minimal duplication

modular architecture

comments only where useful

no dead code

no unnecessary dependencies

no hardcoded credentials

no hardcoded API URLs

no fake production claims

proper error handling

35. DELIVERABLE

Generate the complete React frontend.

Include:

Project setup

Dependencies

Folder structure

Routing

Authentication architecture

Dashboard

Inventory

Forecasting

Reorder Recommendations

Supplier Intelligence

Expiry Risk

Reports

Notifications

Settings

Mock API

Real API abstraction

Responsive layout

Loading states

Error states

Empty states

Reusable UI components

Charts

Tables

Forms

Role-aware navigation

Environment configuration

36. IMPORTANT IMPLEMENTATION RULE

Do NOT build the entire application as one massive component.

Use a proper component architecture.

For example:

Dashboard
 ├── KPIGrid
 ├── DemandForecastChart
 ├── InventoryHealth
 ├── ExpiryRiskSummary
 ├── SupplierPerformance
 └── DecisionIntelligence


Similarly:

ForecastingPage
 ├── ForecastFilters
 ├── ForecastSummary
 ├── ForecastChart
 ├── ModelMetrics
 └── ForecastExplanation


And:

RecommendationsPage
 ├── RecommendationFilters
 ├── RecommendationTable
 ├── RecommendationDetails
 └── ApprovalDialog


37. FINAL DESIGN STANDARD

The final result should resemble a professional enterprise pharmacy intelligence platform.

It should look credible enough that a pharmacy manager could understand and use it without technical training.

It should also be technically impressive enough for a university software-engineering project defense.

The interface must make the following distinction very clear:

RAW DATA
    ↓
ANALYTICS
    ↓
FORECAST
    ↓
DECISION
    ↓
RECOMMENDED ACTION


The frontend is not merely displaying database records.

It is the decision-support interface through which pharmacy personnel interpret inventory intelligence and take informed actions.

Build the UI around that principle.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d65b3955-82b8-415e-bae7-0df62fc1e2c0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
