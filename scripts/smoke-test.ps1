param(
    [string]$BaseUrl = 'http://localhost/BiteRush'
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$pages = @(
    '/',
    '/BiteRushFoodMenuPages/BiteRushBreakfastPage/index.html',
    '/SearchResults/index.html',
    '/DeliveryAddress/index.html',
    '/TrackOrder/index.html',
    '/OrderHistory/index.html',
    '/FeedbackHistory/index.html',
    '/AdminDashboard/login.html'
)

foreach ($page in $pages) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl$page"
    if ([int]$response.StatusCode -ne 200) {
        throw "Expected HTTP 200 for $page; received $($response.StatusCode)."
    }
    Write-Output "OK HTTP $($response.StatusCode) $page"
}

$catalog = Invoke-RestMethod -Uri "$BaseUrl/api/index.php?action=products"
if (-not ($catalog.products -is [array]) -or $catalog.products.Count -eq 0) {
    throw 'The catalog API returned no products. Check the database connection and catalog data.'
}

Write-Output "OK database-backed catalog API returned $($catalog.products.Count) products"
