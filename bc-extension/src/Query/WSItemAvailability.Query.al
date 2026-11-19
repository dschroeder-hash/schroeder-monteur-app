/// <summary>
/// Inventory per item and location (not available in standard API v2.0).
/// Implemented as API query over Item Ledger Entry (sum of Quantity grouped by item and location):
/// read-only, server-side aggregation, supports $filter on itemNumber/locationCode.
/// Note: queries do not support webhooks; the Monteur-App polls this endpoint.
/// </summary>
query 50100 "WS API Item Availability"
{
    QueryType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'itemAvailability';
    EntitySetName = 'itemAvailabilities';
    EntityCaption = 'Item Availability';
    EntitySetCaption = 'Item Availabilities';

    elements
    {
        dataitem(Item; Item)
        {
            column(itemId; SystemId) { }
            column(itemNumber; "No.") { }
            dataitem(ItemLedgerEntry; "Item Ledger Entry")
            {
                DataItemLink = "Item No." = Item."No.";
                SqlJoinType = InnerJoin;

                column(locationCode; "Location Code") { }
                column(inventory; Quantity)
                {
                    Method = Sum;
                }
                column(lastModifiedDateTime; SystemModifiedAt)
                {
                    Method = Max;
                }
            }
        }
    }
}
